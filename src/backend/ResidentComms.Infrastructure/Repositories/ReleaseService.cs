using System.Data;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Data.SqlClient;
using ResidentComms.Domain.Campaigns;
using ResidentComms.Domain.Content;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Repositories;

public sealed record ReleaseOutcome(int MessagesCreated, int Suppressed);

/// <summary>
/// Release (spec §21.2): re-checks approval, suppression and send window, then writes snapshot, recipients, messages,
/// rendered content and outbox rows in ONE transaction. Commit is the last step.
/// </summary>
public sealed class ReleaseService(SqlConnectionFactory db, TimeProvider clock)
{
    private const string Channel = "SMS";

    private static OpResult<ReleaseOutcome> Fail(string code) => OpResult<ReleaseOutcome>.Fail(code);

    public async Task<OpResult<ReleaseOutcome>> ReleaseAsync(Guid tenant, Guid campaignId)
    {
        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();

        // The row lock serialises concurrent releases: the second one sees RELEASED and answers 409.
        var camp = await CampaignQueries.LoadCampaignLockedAsync(c, tx, tenant, campaignId);
        if (camp is null) return Fail("NOT_FOUND");
        if (camp.CampaignState == "RELEASED") return Fail("ALREADY_RELEASED");

        var rev = (await CampaignQueries.LoadCurrentRevisionAsync(c, tx, tenant, campaignId))!;
        if (!rev.IsComplete) return Fail("APPROVAL_INVALID");
        var policy = await CampaignQueries.LoadPolicyAsync(c, tx, tenant);

        // 1. Approval: latest non-invalidated APPROVED whose hash equals the CURRENT revision's package hash.
        var hash = CampaignQueries.Hash(rev, policy);
        var approved = await c.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM Approval WHERE tenant_id = @tenant AND campaign_revision_id = @rev AND decision = 'APPROVED'
                AND invalidated_at IS NULL AND approval_package_hash = @hash",
            new { tenant, rev = rev.CampaignRevisionId, hash }, tx);
        if (approved == 0) return Fail("APPROVAL_INVALID");

        // 2. Send window: evaluated at release time in the tenant's time zone. No bypass.
        var now = clock.GetUtcNow();
        var local = TimeZoneInfo.ConvertTime(now, CampaignQueries.Zone(policy.TimeZone));
        if (!SendWindow.Contains(TimeOnly.FromDateTime(local.DateTime), TimeOnly.FromTimeSpan(policy.SendWindowStart), TimeOnly.FromTimeSpan(policy.SendWindowEnd)))
            return Fail("OUTSIDE_SEND_WINDOW");

        // 3. Suppression: re-read now, not from preflight.
        var members = await CampaignQueries.LoadMembersAsync(c, tx, tenant, rev.AudienceVersionId!.Value);
        var eligible = members.Where(m => !m.Suppressed).ToList();
        var suppressed = members.Count - eligible.Count;
        if (eligible.Count == 0) return Fail("NO_ELIGIBLE_RECIPIENTS");

        // 4. Write everything.
        var snapshotId = Guid.NewGuid();
        await c.ExecuteAsync("INSERT AudienceSnapshot(audience_snapshot_id, tenant_id, audience_version_id, frozen_at) VALUES (@snapshotId, @tenant, @av, @frozen)",
            new { snapshotId, tenant, av = rev.AudienceVersionId, frozen = now.UtcDateTime }, tx);
        await c.ExecuteAsync("UPDATE CampaignRevision SET audience_snapshot_id = @snapshotId WHERE tenant_id = @tenant AND campaign_revision_id = @rev",
            new { snapshotId, tenant, rev = rev.CampaignRevisionId }, tx);

        var recipients = NewTable(("campaign_recipient_id", typeof(Guid)), ("tenant_id", typeof(Guid)), ("campaign_id", typeof(Guid)),
            ("audience_snapshot_id", typeof(Guid)), ("source_recipient_id", typeof(string)), ("approved_identity_key", typeof(string)));
        var messages = NewTable(("message_id", typeof(Guid)), ("tenant_id", typeof(Guid)), ("campaign_id", typeof(Guid)), ("campaign_revision_id", typeof(Guid)),
            ("campaign_recipient_id", typeof(Guid)), ("channel", typeof(string)), ("channel_sequence_no", typeof(int)), ("idempotency_key", typeof(string)),
            ("destination_raw", typeof(string)), ("destination_value", typeof(string)), ("content_hash", typeof(string)),
            ("processing_state", typeof(string)), ("handoff_state", typeof(string)), ("delivery_state", typeof(string)), ("data_quality", typeof(string)),
            ("delivery_conflict", typeof(bool)));
        var contents = NewTable(("message_id", typeof(Guid)), ("tenant_id", typeof(Guid)), ("rendered_text", typeof(string)));
        var outbox = NewTable(("tenant_id", typeof(Guid)), ("message_type", typeof(string)), ("aggregate_id", typeof(Guid)));

        var defaults = rev.Defaults;
        foreach (var m in eligible)
        {
            var recipientId = Guid.NewGuid(); var messageId = Guid.NewGuid();
            var text = TemplateRenderer.Render(rev.ContentText!, m.Variables, defaults).Text;
            recipients.Rows.Add(recipientId, tenant, campaignId, snapshotId, m.SourceRecipientId, m.ApprovedIdentityKey);
            messages.Rows.Add(messageId, tenant, campaignId, rev.CampaignRevisionId, recipientId, Channel, 1,
                MessageKey.For(tenant, campaignId, m.ApprovedIdentityKey, Channel, 1),
                (object?)m.PhoneRaw ?? DBNull.Value, m.PhoneNormalized, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text))),
                "QUEUED", "NOT_HANDED_OFF", "NOT_REPORTED", "CURRENT", false);
            contents.Rows.Add(messageId, tenant, text);
            outbox.Rows.Add(tenant, "dispatch.sms", messageId);
        }

        await BulkAsync(c, tx, "CampaignRecipient", recipients);
        await BulkAsync(c, tx, "Message", messages);
        await BulkAsync(c, tx, "MessageContent", contents);
        await BulkAsync(c, tx, "OutboxMessage", outbox);

        await c.ExecuteAsync("UPDATE Campaign SET campaign_state = 'RELEASED', updated_at = @now WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { now = now.UtcDateTime, tenant, campaignId }, tx);

        await tx.CommitAsync(); // last step
        return OpResult<ReleaseOutcome>.Success(new ReleaseOutcome(eligible.Count, suppressed));
    }

    private static DataTable NewTable(params (string Name, Type Type)[] columns)
    {
        var t = new DataTable();
        foreach (var (name, type) in columns) t.Columns.Add(name, type);
        return t;
    }

    // CheckConstraints keeps the foreign keys trusted (bulk copy skips them by default).
    private static async Task BulkAsync(SqlConnection c, SqlTransaction tx, string table, DataTable data)
    {
        using var bulk = new SqlBulkCopy(c, SqlBulkCopyOptions.CheckConstraints, tx) { DestinationTableName = table, BulkCopyTimeout = 120 };
        foreach (DataColumn col in data.Columns) bulk.ColumnMappings.Add(col.ColumnName, col.ColumnName);
        await bulk.WriteToServerAsync(data);
    }
}
