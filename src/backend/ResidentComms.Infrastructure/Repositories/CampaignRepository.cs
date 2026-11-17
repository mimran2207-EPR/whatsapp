using Dapper;
using Microsoft.Data.SqlClient;
using ResidentComms.Domain.Campaigns;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Repositories;

public sealed record DraftPatch(Guid? AudienceVersionId, string? Channel, string? ContentText, IReadOnlyDictionary<string, string>? FieldDefaults, DateTimeOffset? ScheduledAt);
public sealed record PatchOutcome(Guid RevisionId, bool ApprovalInvalidated);
public sealed record PreflightReport(IReadOnlyList<FindingDto> Findings, int EligibleRecipients, int SegmentsPerMessage, string Encoding, decimal CostMin, decimal CostMax);
public sealed record CampaignListItem(Guid CampaignId, string Name, string Purpose, string State, string? Channel, int Recipients, int Accepted, int Delivered, int Unknown, int Failed);
public sealed record ApprovalListItem(Guid CampaignId, string Name, string Purpose, string SubmittedBy, string? Channel, int Recipients, string PackageHash);

public sealed class CampaignRepository(SqlConnectionFactory db, TimeProvider clock)
{
    public const int MaxContentLength = 2000;

    private static OpResult<T> Fail<T>(string code, params (string Key, object? Value)[] details)
        => OpResult<T>.Fail(code, details.Length == 0 ? null : details.ToDictionary(d => d.Key, d => d.Value));

    public async Task<(Guid CampaignId, Guid RevisionId)> CreateAsync(Guid tenant, string department, string userId, string name, string purpose)
    {
        var campaignId = Guid.NewGuid(); var revisionId = Guid.NewGuid();
        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        await c.ExecuteAsync(
            @"INSERT Campaign(campaign_id, tenant_id, department_id, campaign_name, campaign_type, communication_purpose, campaign_state, created_by, created_at, updated_at)
              VALUES (@campaignId, @tenant, @department, @name, 'MANUAL', @purpose, 'DRAFT', @userId, @now, @now)",
            new { campaignId, tenant, department, name, purpose, userId, now = clock.GetUtcNow().UtcDateTime }, tx);
        await c.ExecuteAsync("INSERT CampaignRevision(campaign_revision_id, tenant_id, campaign_id, revision_no) VALUES (@revisionId, @tenant, @campaignId, 1)",
            new { revisionId, tenant, campaignId }, tx);
        await tx.CommitAsync();
        return (campaignId, revisionId);
    }

    /// <summary>Applies a draft change. DRAFT: edited in place. SUBMITTED/APPROVED: a new revision, and any approval is invalidated.</summary>
    public async Task<OpResult<PatchOutcome>> PatchDraftAsync(Guid tenant, Guid campaignId, DraftPatch p)
    {
        if (p.Channel is not null && p.Channel != "SMS") return Fail<PatchOutcome>("CHANNEL_NOT_SUPPORTED");
        if (p.ContentText is not null && (string.IsNullOrWhiteSpace(p.ContentText) || p.ContentText.Length > MaxContentLength)) return Fail<PatchOutcome>("VALIDATION_FAILED");
        if (p.FieldDefaults is { Count: > 50 }) return Fail<PatchOutcome>("VALIDATION_FAILED");

        var now = clock.GetUtcNow().UtcDateTime;
        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        var camp = await CampaignQueries.LoadCampaignLockedAsync(c, tx, tenant, campaignId);
        if (camp is null) return Fail<PatchOutcome>("NOT_FOUND");
        if (camp.CampaignState == "RELEASED") return Fail<PatchOutcome>("ALREADY_RELEASED");
        var rev = (await CampaignQueries.LoadCurrentRevisionAsync(c, tx, tenant, campaignId))!;

        if (p.AudienceVersionId is { } av
            && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM AudienceVersion WHERE tenant_id = @tenant AND audience_version_id = @av", new { tenant, av }, tx) == 0)
            return Fail<PatchOutcome>("AUDIENCE_NOT_FOUND");

        var audience = p.AudienceVersionId ?? rev.AudienceVersionId;
        var channel = p.Channel ?? rev.Channel;
        var content = p.ContentText ?? rev.ContentText;
        var defaultsJson = p.FieldDefaults is null ? rev.FieldDefaultsJson : CampaignQueries.DefaultsJson(p.FieldDefaults);
        var scheduled = p.ScheduledAt is { } s ? TruncateMs(s.UtcDateTime) : rev.ScheduledAt;

        var changed = audience != rev.AudienceVersionId || channel != rev.Channel || content != rev.ContentText
            || (defaultsJson ?? "{}") != (rev.FieldDefaultsJson ?? "{}") || scheduled != rev.ScheduledAt;
        if (!changed) return OpResult<PatchOutcome>.Success(new PatchOutcome(rev.CampaignRevisionId, false));

        Guid revisionId; var invalidated = false;
        if (camp.CampaignState == "DRAFT")
        {
            revisionId = rev.CampaignRevisionId;
            await c.ExecuteAsync(
                @"UPDATE CampaignRevision SET audience_version_id = @audience, channel = @channel, content_text = @content,
                         field_defaults_json = @defaultsJson, scheduled_at = @scheduled
                  WHERE tenant_id = @tenant AND campaign_revision_id = @revisionId",
                new { audience, channel, content, defaultsJson, scheduled, tenant, revisionId }, tx);
        }
        else
        {
            revisionId = Guid.NewGuid();
            await c.ExecuteAsync(
                @"INSERT CampaignRevision(campaign_revision_id, tenant_id, campaign_id, revision_no, audience_version_id, channel, content_text, field_defaults_json, scheduled_at)
                  VALUES (@revisionId, @tenant, @campaignId, @no, @audience, @channel, @content, @defaultsJson, @scheduled)",
                new { revisionId, tenant, campaignId, no = rev.RevisionNo + 1, audience, channel, content, defaultsJson, scheduled }, tx);
            invalidated = await c.ExecuteAsync(
                @"UPDATE a SET invalidated_at = @now FROM Approval a
                  JOIN CampaignRevision r ON r.tenant_id = a.tenant_id AND r.campaign_revision_id = a.campaign_revision_id
                  WHERE a.tenant_id = @tenant AND r.campaign_id = @campaignId AND a.invalidated_at IS NULL",
                new { now, tenant, campaignId }, tx) > 0;
        }
        await c.ExecuteAsync("UPDATE Campaign SET campaign_state = 'DRAFT', updated_at = @now WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { now, tenant, campaignId }, tx);
        await tx.CommitAsync();
        return OpResult<PatchOutcome>.Success(new PatchOutcome(revisionId, invalidated));
    }

    private static DateTime TruncateMs(DateTime d) => new(d.Ticks - d.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

    public async Task<OpResult<PreflightReport>> PreflightAsync(Guid tenant, Guid campaignId)
    {
        await using var c = await db.OpenAsync();
        var camp = await c.QuerySingleOrDefaultAsync<CampaignRow>(
            "SELECT campaign_id AS CampaignId, campaign_state AS CampaignState, created_by AS CreatedBy, department_id AS DepartmentId FROM Campaign WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { tenant, campaignId });
        if (camp is null) return Fail<PreflightReport>("NOT_FOUND");
        var rev = (await CampaignQueries.LoadCurrentRevisionAsync(c, null, tenant, campaignId))!;
        if (!rev.IsComplete) return Fail<PreflightReport>("DRAFT_INCOMPLETE");
        var ev = await CampaignQueries.EvaluateAsync(c, null, tenant, campaignId, rev, await CampaignQueries.LoadPolicyAsync(c, null, tenant), clock.GetUtcNow());
        return OpResult<PreflightReport>.Success(ToReport(ev));
    }

    private static PreflightReport ToReport(Evaluation ev)
        => new(ev.Findings.Select(CampaignQueries.ToDto).ToList(), ev.EligibleRecipients, ev.SegmentsPerMessage, ev.Encoding, ev.CostMin, ev.CostMax);

    public async Task<OpResult<string>> SubmitAsync(Guid tenant, Guid campaignId)
    {
        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        var camp = await CampaignQueries.LoadCampaignLockedAsync(c, tx, tenant, campaignId);
        if (camp is null) return Fail<string>("NOT_FOUND");
        if (camp.CampaignState != "DRAFT") return Fail<string>(camp.CampaignState == "RELEASED" ? "ALREADY_RELEASED" : "INVALID_STATE");
        var rev = (await CampaignQueries.LoadCurrentRevisionAsync(c, tx, tenant, campaignId))!;
        if (!rev.IsComplete) return Fail<string>("DRAFT_INCOMPLETE");

        var now = clock.GetUtcNow();
        var ev = await CampaignQueries.EvaluateAsync(c, tx, tenant, campaignId, rev, await CampaignQueries.LoadPolicyAsync(c, tx, tenant), now);
        if (ev.Blocked)
            return Fail<string>("PREFLIGHT_BLOCKED", ("findings", ev.Findings.Select(CampaignQueries.ToDto).ToList()));

        await c.ExecuteAsync("UPDATE CampaignRevision SET approval_package_hash = @hash WHERE tenant_id = @tenant AND campaign_revision_id = @id",
            new { hash = ev.PackageHash, tenant, id = rev.CampaignRevisionId }, tx);
        await c.ExecuteAsync("UPDATE Campaign SET campaign_state = 'SUBMITTED', updated_at = @now WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { now = now.UtcDateTime, tenant, campaignId }, tx);
        await tx.CommitAsync();
        return OpResult<string>.Success(ev.PackageHash);
    }

    /// <summary>The caller must already hold the approver role (checked at the API layer).</summary>
    public async Task<OpResult<Guid>> ApproveAsync(Guid tenant, Guid campaignId, string approverId, string approverDepartment, string packageHash)
    {
        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        var camp = await CampaignQueries.LoadCampaignLockedAsync(c, tx, tenant, campaignId);
        if (camp is null) return Fail<Guid>("NOT_FOUND");
        if (camp.DepartmentId != approverDepartment) return Fail<Guid>("FORBIDDEN_DEPARTMENT");
        if (camp.CampaignState == "RELEASED") return Fail<Guid>("ALREADY_RELEASED");
        if (camp.CampaignState != "SUBMITTED") return Fail<Guid>("INVALID_STATE");
        var rev = (await CampaignQueries.LoadCurrentRevisionAsync(c, tx, tenant, campaignId))!;
        if (!rev.IsComplete) return Fail<Guid>("INVALID_STATE");

        var policy = await CampaignQueries.LoadPolicyAsync(c, tx, tenant);
        var current = CampaignQueries.Hash(rev, policy);
        var recipients = (await CampaignQueries.LoadMembersAsync(c, tx, tenant, rev.AudienceVersionId!.Value)).Count(m => !m.Suppressed);

        var decision = ApprovalPolicy.Check(approverId, true, camp.CreatedBy, recipients, policy.SelfApprovalMaxRecipients, packageHash, current);
        switch (decision)
        {
            case ApprovalDecision.StaleRevision: return Fail<Guid>("STALE_REVISION");
            case ApprovalDecision.SelfApprovalAboveThreshold: return Fail<Guid>("SELF_APPROVAL_ABOVE_THRESHOLD");
            case ApprovalDecision.NotApproverRole: return Fail<Guid>("NOT_APPROVER");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var approvalId = Guid.NewGuid();
        await c.ExecuteAsync(
            @"INSERT Approval(approval_id, tenant_id, campaign_revision_id, approval_package_hash, decision, decided_by, decided_at)
              VALUES (@approvalId, @tenant, @rev, @hash, 'APPROVED', @approverId, @now)",
            new { approvalId, tenant, rev = rev.CampaignRevisionId, hash = current, approverId, now }, tx);
        await c.ExecuteAsync("UPDATE Campaign SET campaign_state = 'APPROVED', updated_at = @now WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { now, tenant, campaignId }, tx);
        await tx.CommitAsync();
        return OpResult<Guid>.Success(approvalId);
    }

    public async Task<IReadOnlyList<CampaignListItem>> ListAsync(Guid tenant)
    {
        await using var c = await db.OpenAsync();
        var rows = await c.QueryAsync<CampaignListItem>(
            @"SELECT c.campaign_id AS CampaignId, c.campaign_name AS Name, c.communication_purpose AS Purpose, c.campaign_state AS State, r.channel AS Channel,
                     CASE WHEN c.campaign_state = 'RELEASED'
                          THEN (SELECT COUNT(*) FROM CampaignRecipient cr WHERE cr.tenant_id = c.tenant_id AND cr.campaign_id = c.campaign_id)
                          ELSE (SELECT COUNT(*) FROM AudienceMember m WHERE m.tenant_id = c.tenant_id AND m.audience_version_id = r.audience_version_id
                                  AND m.validation_state = 'VALID' AND m.phone_normalized IS NOT NULL) END AS Recipients,
                     (SELECT COUNT(*) FROM Message x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id AND x.handoff_state = 'ACCEPTED') AS Accepted,
                     (SELECT COUNT(*) FROM Message x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id AND x.delivery_state = 'DELIVERED') AS Delivered,
                     (SELECT COUNT(*) FROM Message x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id AND (x.delivery_state = 'UNKNOWN' OR x.handoff_state = 'UNKNOWN')) AS Unknown,
                     (SELECT COUNT(*) FROM Message x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id AND (x.delivery_state = 'FAILED' OR x.handoff_state = 'REJECTED')) AS Failed
              FROM Campaign c
              JOIN CampaignRevision r ON r.tenant_id = c.tenant_id AND r.campaign_id = c.campaign_id
               AND r.revision_no = (SELECT MAX(x.revision_no) FROM CampaignRevision x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id)
              WHERE c.tenant_id = @tenant ORDER BY c.created_at DESC", new { tenant });
        return rows.ToList();
    }

    public DateTimeOffset DataAsOf => clock.GetUtcNow();

    /// <summary>SUBMITTED campaigns the approver may approve: not the creator above the self-approval threshold.</summary>
    public async Task<IReadOnlyList<ApprovalListItem>> ListApprovalsAsync(Guid tenant, string userId, string department)
    {
        await using var c = await db.OpenAsync();
        var max = (await CampaignQueries.LoadPolicyAsync(c, null, tenant)).SelfApprovalMaxRecipients;
        var rows = await c.QueryAsync<(Guid CampaignId, string Name, string Purpose, string CreatedBy, string? Channel, int Recipients, string? Hash)>(
            @"SELECT c.campaign_id, c.campaign_name, c.communication_purpose, c.created_by, r.channel,
                     (SELECT COUNT(*) FROM AudienceMember m WHERE m.tenant_id = c.tenant_id AND m.audience_version_id = r.audience_version_id
                        AND m.validation_state = 'VALID' AND m.phone_normalized IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM SuppressionEntry s WHERE s.tenant_id = m.tenant_id AND s.channel = 'SMS' AND s.destination_normalized = m.phone_normalized)) AS Recipients,
                     r.approval_package_hash
              FROM Campaign c
              JOIN CampaignRevision r ON r.tenant_id = c.tenant_id AND r.campaign_id = c.campaign_id
               AND r.revision_no = (SELECT MAX(x.revision_no) FROM CampaignRevision x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id)
              WHERE c.tenant_id = @tenant AND c.department_id = @department AND c.campaign_state = 'SUBMITTED' ORDER BY c.updated_at", new { tenant, department });
        return rows.Where(r => !(r.CreatedBy == userId && r.Recipients > max))
            .Select(r => new ApprovalListItem(r.CampaignId, r.Name, r.Purpose, r.CreatedBy, r.Channel, r.Recipients, r.Hash ?? "")).ToList();
    }
}
