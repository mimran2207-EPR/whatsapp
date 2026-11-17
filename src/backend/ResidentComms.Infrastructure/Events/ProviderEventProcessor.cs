using Dapper;
using Microsoft.Data.SqlClient;
using ResidentComms.Domain.Status;
using ResidentComms.Infrastructure.Messaging;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Events;

/// <summary>A parsed (already signature-verified) provider event. TenantId is only a fallback for events that match no message.</summary>
public sealed record ProviderEvent(string ProviderEventId, string? ProviderMessageId, string Type, DateTimeOffset? OccurredAt, Guid? TenantId);

public enum EventOutcome { Applied, Duplicate, Unattributed, NoTenant }

/// <summary>
/// Stores the raw event (append-only) and applies it to the message in ONE transaction; commit is the last step.
/// Dedup by deduplication_key "mock:{providerEventId}": a duplicate changes nothing.
/// </summary>
public sealed class ProviderEventProcessor(SqlConnectionFactory db, TimeProvider clock)
{
    public const string ProviderId = "mock-sms";

    private sealed record MsgRow(Guid MessageId, Guid TenantId, string DeliveryState, bool DeliveryConflict, DateTime? ReadAt, Guid? AttemptId);

    public async Task<EventOutcome> ProcessAsync(ProviderEvent e, CancellationToken ct = default)
    {
        var (canonical, delivery) = Map(e.Type);
        var now = clock.GetUtcNow().UtcDateTime;
        var dedup = "mock:" + e.ProviderEventId;

        await using var c = await db.OpenAsync(ct);
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync(ct);

        MsgRow? msg = null;
        if (!string.IsNullOrWhiteSpace(e.ProviderMessageId))
            msg = await c.QuerySingleOrDefaultAsync<MsgRow>(new CommandDefinition(
                @"SELECT m.message_id AS MessageId, m.tenant_id AS TenantId, m.delivery_state AS DeliveryState, m.delivery_conflict AS DeliveryConflict, m.read_at AS ReadAt,
                         (SELECT TOP 1 attempt_id FROM SendAttempt a WHERE a.tenant_id = m.tenant_id AND a.message_id = m.message_id AND a.provider_message_id = @pm ORDER BY attempt_number DESC) AS AttemptId
                  FROM Message m WITH (UPDLOCK, ROWLOCK) WHERE m.provider_id = @provider AND m.provider_message_id = @pm",
                new { provider = ProviderId, pm = e.ProviderMessageId }, tx, cancellationToken: ct));

        var tenant = msg?.TenantId ?? e.TenantId;
        if (tenant is null) return EventOutcome.NoTenant;

        try
        {
            await c.ExecuteAsync(new CommandDefinition(
                @"INSERT MessageEvent(event_id, tenant_id, message_id, attempt_id, provider_event_id, deduplication_key, event_type_raw, event_type, event_source,
                                      occurred_at, received_at, processed_at, signature_valid, correlation_quality)
                  VALUES (@id, @tenant, @msgId, @attemptId, @pe, @dedup, @raw, @type, 'WEBHOOK', @occ, @now, @now, 1, @quality)",
                new
                {
                    id = Guid.NewGuid(), tenant, msgId = msg?.MessageId, attemptId = msg?.AttemptId, pe = e.ProviderEventId, dedup,
                    raw = e.Type, type = canonical, occ = e.OccurredAt?.UtcDateTime, now, quality = msg is null ? "UNATTRIBUTED" : "PROVIDER_MESSAGE_ID",
                }, tx, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            return EventOutcome.Duplicate; // the transaction rolls back on dispose; no new fact
        }

        if (msg is null) { await tx.CommitAsync(ct); return EventOutcome.Unattributed; }

        if (delivery is { } incoming)
        {
            var current = StatusMapper.FromDb<DeliveryState>(msg.DeliveryState);
            var merged = DeliveryMerge.Apply(current, incoming, msg.DeliveryConflict);
            await c.ExecuteAsync(new CommandDefinition(
                @"UPDATE Message SET delivery_state = @state, provider_status_raw = @raw,
                         delivery_conflict = CASE WHEN @conflict = 1 THEN 1 ELSE delivery_conflict END,
                         data_quality = CASE WHEN @conflict = 1 THEN 'CONFLICTING' ELSE data_quality END
                  WHERE tenant_id = @tenant AND message_id = @id",
                new { state = StatusMapper.ToDb(merged.State), raw = e.Type, conflict = merged.Conflict, tenant, id = msg.MessageId }, tx, cancellationToken: ct));
        }
        else if (canonical == "READ" && msg.ReadAt is null)
        {
            await c.ExecuteAsync(new CommandDefinition(
                "UPDATE Message SET read_at = @at, provider_status_raw = @raw WHERE tenant_id = @tenant AND message_id = @id",
                new { at = e.OccurredAt?.UtcDateTime ?? now, raw = e.Type, tenant, id = msg.MessageId }, tx, cancellationToken: ct));
        }

        await tx.CommitAsync(ct); // last step
        return EventOutcome.Applied;
    }

    /// <summary>sent→SENT_PER_PROVIDER, delivered→DELIVERED, failed→FAILED; read is an interaction flag, not delivery.</summary>
    private static (string Canonical, DeliveryState? Delivery) Map(string raw) => raw.Trim().ToLowerInvariant() switch
    {
        "sent" => ("SENT", DeliveryState.SentPerProvider),
        "delivered" => ("DELIVERED", DeliveryState.Delivered),
        "failed" => ("FAILED", DeliveryState.Failed),
        "read" => ("READ", null),
        _ => ("UNKNOWN", null),
    };
}
