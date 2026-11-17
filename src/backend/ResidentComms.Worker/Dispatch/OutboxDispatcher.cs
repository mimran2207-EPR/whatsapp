using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ResidentComms.Infrastructure.Events;
using ResidentComms.Infrastructure.Sql;
using ResidentComms.Worker.Providers;

namespace ResidentComms.Worker.Dispatch;

/// <summary>
/// Polls OutboxMessage ('dispatch.sms') and hands each message to the SMS adapter. One outbox row per DB transaction.
/// Phase A (own tx): claim state + SendAttempt (outcome NULL) is committed BEFORE the request leaves.
/// Phase B (own tx): attempt result, message state and outbox.processed_at are committed together.
/// If the process dies between A and B the open attempt is found on re-claim and becomes AMBIGUOUS: never a blind resend (spec §9, §21.4).
/// Time comes from the database clock so it agrees with the column defaults.
/// </summary>
public sealed class OutboxDispatcher(SqlConnectionFactory db, ISmsAdapter adapter, ILogger<OutboxDispatcher> log) : BackgroundService
{
    public const int MaxAttempts = 5;
    private const int BatchSize = 50, LockSeconds = 30;

    private sealed record Claimed(long OutboxId, Guid TenantId, Guid MessageId, int Attempts);
    private sealed record Msg(string HandoffState, string ProcessingState, string DestinationValue, string IdempotencyKey, string? Text);
    private sealed record AttemptRow(int AttemptNumber, string? Outcome);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            int n = 0;
            try { n = await RunOnceAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Outbox dispatch cycle failed"); }
            if (n == 0) try { await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>One polling cycle: claims up to 50 rows and processes them. Returns the number of rows claimed.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        List<Claimed> batch;
        await using (var c = await db.OpenAsync(ct))
            batch = (await c.QueryAsync<Claimed>(new CommandDefinition(
                @"UPDATE TOP (@batch) o SET locked_until = DATEADD(second, @lock, SYSUTCDATETIME())
                  OUTPUT inserted.outbox_id AS OutboxId, inserted.tenant_id AS TenantId, inserted.aggregate_id AS MessageId, inserted.attempts AS Attempts
                  FROM OutboxMessage o WITH (ROWLOCK, READPAST, UPDLOCK)
                  WHERE o.message_type = 'dispatch.sms' AND o.processed_at IS NULL AND o.available_at <= SYSUTCDATETIME()
                    AND (o.locked_until IS NULL OR o.locked_until < SYSUTCDATETIME())",
                new { batch = BatchSize, @lock = LockSeconds }, cancellationToken: ct))).ToList();

        foreach (var row in batch)
        {
            ct.ThrowIfCancellationRequested();
            try { await ProcessAsync(row, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) { log.LogError(ex, "Dispatch of message {MessageId} failed unexpectedly; it will be re-claimed when the lock expires", row.MessageId); }
        }
        return batch.Count;
    }

    private async Task ProcessAsync(Claimed row, CancellationToken ct)
    {
        // ---- Phase A ----
        int attemptNumber; Msg msg; Guid attemptId = Guid.NewGuid();
        await using (var c = await db.OpenAsync(ct))
        await using (var tx = (SqlTransaction)await c.BeginTransactionAsync(ct))
        {
            var m = await c.QuerySingleOrDefaultAsync<Msg>(new CommandDefinition(
                @"SELECT m.handoff_state AS HandoffState, m.processing_state AS ProcessingState, m.destination_value AS DestinationValue, m.idempotency_key AS IdempotencyKey, mc.rendered_text AS Text
                  FROM Message m WITH (UPDLOCK, ROWLOCK) LEFT JOIN MessageContent mc ON mc.tenant_id = m.tenant_id AND mc.message_id = m.message_id
                  WHERE m.tenant_id = @t AND m.message_id = @id", new { t = row.TenantId, id = row.MessageId }, tx, cancellationToken: ct));
            var attempts = (await c.QueryAsync<AttemptRow>(new CommandDefinition(
                "SELECT attempt_number AS AttemptNumber, attempt_outcome AS Outcome FROM SendAttempt WHERE tenant_id = @t AND message_id = @id ORDER BY attempt_number",
                new { t = row.TenantId, id = row.MessageId }, tx, cancellationToken: ct))).ToList();

            if (m is null || m.ProcessingState == "CANCELED" || m.Text is null || m.HandoffState != "NOT_HANDED_OFF"
                || attempts.Any(a => a.Outcome is "ACCEPTED" or "REJECTED" or "AMBIGUOUS"))
            {
                await MarkProcessed(c, tx, row, m is null ? "message missing" : m.Text is null ? "content purged" : "already decided or canceled", ct);
                await tx.CommitAsync(ct);
                return;
            }

            if (attempts.FirstOrDefault(a => a.Outcome is null) is { } open)
            {
                // A previous run died after the request may have left: ambiguous, never resend blindly.
                await c.ExecuteAsync(new CommandDefinition(
                    "UPDATE SendAttempt SET attempt_outcome = 'AMBIGUOUS', acceptance_ambiguous = 1 WHERE tenant_id = @t AND message_id = @id AND attempt_number = @n",
                    new { t = row.TenantId, id = row.MessageId, n = open.AttemptNumber }, tx, cancellationToken: ct));
                await SetAmbiguous(c, tx, row);
                await MarkProcessed(c, tx, row, "recovered open attempt as ambiguous", ct);
                await tx.CommitAsync(ct);
                return;
            }

            attemptNumber = (attempts.Count == 0 ? 0 : attempts.Max(a => a.AttemptNumber)) + 1;
            await c.ExecuteAsync(new CommandDefinition(
                @"INSERT SendAttempt(attempt_id, tenant_id, message_id, attempt_number, attempt_reason, request_started_at)
                  VALUES (@attemptId, @t, @id, @n, @reason, SYSUTCDATETIME());
                  UPDATE Message SET processing_state = 'IN_PROGRESS', handoff_state = 'HANDED_OFF' WHERE tenant_id = @t AND message_id = @id",
                new { attemptId, t = row.TenantId, id = row.MessageId, n = attemptNumber, reason = attemptNumber == 1 ? "INITIAL" : "CONTROLLED_RETRY" }, tx, cancellationToken: ct));
            msg = m;
            await tx.CommitAsync(ct);
        }

        // ---- the adapter call (outside any transaction) ----
        SendOutcome? outcome = null; string? localError = null;
        try { outcome = await adapter.SendAsync(new SmsSendRequest(row.MessageId, msg.DestinationValue, msg.Text!, msg.IdempotencyKey), ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; } // attempt stays open -> AMBIGUOUS on re-claim
        catch (Exception ex) { localError = ex.Message; }

        // ---- Phase B ----
        await using (var c = await db.OpenAsync(ct))
        await using (var tx = (SqlTransaction)await c.BeginTransactionAsync(ct))
        {
            var p = new { t = row.TenantId, id = row.MessageId, n = attemptNumber, pm = outcome?.ProviderMessageId, err = outcome?.ErrorCode };
            if (outcome is null)
            {
                await c.ExecuteAsync(new CommandDefinition(
                    @"UPDATE SendAttempt SET attempt_outcome = 'LOCAL_FAILURE', response_received_at = SYSUTCDATETIME(), provider_error_code = LEFT(@e, 100) WHERE tenant_id = @t AND message_id = @id AND attempt_number = @n",
                    new { p.t, p.id, p.n, e = localError }, tx, cancellationToken: ct));
                var exhausted = row.Attempts + 1 >= MaxAttempts;
                await c.ExecuteAsync(new CommandDefinition(
                    @"UPDATE Message SET handoff_state = 'NOT_HANDED_OFF',
                             processing_state = CASE WHEN @exhausted = 1 THEN 'REJECTED_BEFORE_SEND' ELSE processing_state END
                      WHERE tenant_id = @t AND message_id = @id;
                      UPDATE OutboxMessage SET attempts = attempts + 1, last_error = LEFT(@e, 400), locked_until = NULL,
                             available_at = DATEADD(second, POWER(2, attempts + 1), SYSUTCDATETIME()),
                             processed_at = CASE WHEN @exhausted = 1 THEN SYSUTCDATETIME() ELSE NULL END
                      WHERE outbox_id = @outbox",
                    new { p.t, p.id, exhausted, e = localError, outbox = row.OutboxId }, tx, cancellationToken: ct));
            }
            else if (outcome.Kind == SendOutcome.Accepted)
            {
                await c.ExecuteAsync(new CommandDefinition(
                    @"UPDATE SendAttempt SET attempt_outcome = 'ACCEPTED', response_received_at = SYSUTCDATETIME(), provider_message_id = @pm WHERE tenant_id = @t AND message_id = @id AND attempt_number = @n;
                      UPDATE Message SET handoff_state = 'ACCEPTED', provider_id = @provider, provider_message_id = @pm WHERE tenant_id = @t AND message_id = @id",
                    new { p.t, p.id, p.n, p.pm, provider = ProviderEventProcessor.ProviderId }, tx, cancellationToken: ct));
                await MarkProcessed(c, tx, row, null, ct);
            }
            else if (outcome.Kind == SendOutcome.Rejected)
            {
                await c.ExecuteAsync(new CommandDefinition(
                    @"UPDATE SendAttempt SET attempt_outcome = 'REJECTED', response_received_at = SYSUTCDATETIME(), provider_error_code = @err WHERE tenant_id = @t AND message_id = @id AND attempt_number = @n;
                      UPDATE Message SET handoff_state = 'REJECTED' WHERE tenant_id = @t AND message_id = @id",
                    new { p.t, p.id, p.n, p.err }, tx, cancellationToken: ct));
                await MarkProcessed(c, tx, row, null, ct);
            }
            else // AMBIGUOUS: the request may have reached the provider. No retry.
            {
                await c.ExecuteAsync(new CommandDefinition(
                    @"UPDATE SendAttempt SET attempt_outcome = 'AMBIGUOUS', acceptance_ambiguous = 1, provider_error_code = @err WHERE tenant_id = @t AND message_id = @id AND attempt_number = @n",
                    new { p.t, p.id, p.n, p.err }, tx, cancellationToken: ct));
                await SetAmbiguous(c, tx, row);
                await MarkProcessed(c, tx, row, null, ct);
            }
            await tx.CommitAsync(ct); // last step
        }
    }

    private static Task SetAmbiguous(SqlConnection c, SqlTransaction tx, Claimed row) => c.ExecuteAsync(
        "UPDATE Message SET handoff_state = 'UNKNOWN', processing_state = 'IN_PROGRESS' WHERE tenant_id = @t AND message_id = @id",
        new { t = row.TenantId, id = row.MessageId }, tx);

    private static Task MarkProcessed(SqlConnection c, SqlTransaction tx, Claimed row, string? note, CancellationToken ct) => c.ExecuteAsync(new CommandDefinition(
        "UPDATE OutboxMessage SET processed_at = SYSUTCDATETIME(), locked_until = NULL, last_error = COALESCE(@note, last_error) WHERE outbox_id = @outbox",
        new { outbox = row.OutboxId, note }, tx, cancellationToken: ct));
}
