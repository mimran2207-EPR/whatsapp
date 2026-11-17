using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using ResidentComms.Domain.Campaigns;
using ResidentComms.Domain.Content;

namespace ResidentComms.Infrastructure.Repositories;

public sealed class CampaignRow
{
    public Guid CampaignId { get; set; }
    public string CampaignState { get; set; } = "";
    public string CreatedBy { get; set; } = "";
    public string DepartmentId { get; set; } = "";
}

public sealed class RevisionRow
{
    public Guid CampaignRevisionId { get; set; }
    public int RevisionNo { get; set; }
    public Guid? AudienceVersionId { get; set; }
    public string? Channel { get; set; }
    public string? ContentText { get; set; }
    public string? FieldDefaultsJson { get; set; }
    public DateTime? ScheduledAt { get; set; }

    public bool IsComplete => AudienceVersionId is not null && Channel is not null && !string.IsNullOrWhiteSpace(ContentText);
    public IReadOnlyDictionary<string, string> Defaults => CampaignQueries.ParseDefaults(FieldDefaultsJson);
    public DateTimeOffset? ScheduledAtUtc => ScheduledAt is null ? null : new DateTimeOffset(DateTime.SpecifyKind(ScheduledAt.Value, DateTimeKind.Utc));
}

public sealed class PolicyRow
{
    public TimeSpan SendWindowStart { get; set; }
    public TimeSpan SendWindowEnd { get; set; }
    public string TimeZone { get; set; } = "Asia/Jerusalem";
    public int SelfApprovalMaxRecipients { get; set; } = 1000;
    public int DuplicateWindowDays { get; set; } = 7;
    public int PolicyVersion { get; set; } = 1;
}

public sealed class MemberRow
{
    public Guid AudienceMemberId { get; set; }
    public string ApprovedIdentityKey { get; set; } = "";
    public string SourceRecipientId { get; set; } = "";
    public string? PhoneRaw { get; set; }
    public string PhoneNormalized { get; set; } = "";
    public string? VariablesJson { get; set; }
    public bool Suppressed { get; set; }

    public IReadOnlyDictionary<string, string?> Variables => CampaignQueries.ParseVariables(VariablesJson);
}

public sealed record Evaluation(
    IReadOnlyList<PreflightFinding> Findings,
    int EligibleRecipients,
    int SegmentsPerMessage,
    string Encoding,
    decimal CostMin,
    decimal CostMax,
    string PackageHash)
{
    public bool Blocked => Findings.Any(f => f.Severity == PreflightSeverity.Blocker);
}

/// <summary>Shared loaders and the preflight evaluation, used by CampaignRepository and ReleaseService. All queries filter by tenant.</summary>
internal static class CampaignQueries
{
    // Placeholder SMS price per segment (ILS). The real price depends on the provider contract (spec §6); reported as an estimate only.
    private const decimal CostPerSegmentMin = 0.05m, CostPerSegmentMax = 0.12m;

    public static IReadOnlyDictionary<string, string> ParseDefaults(string? json)
        => string.IsNullOrWhiteSpace(json) ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? new Dictionary<string, string>();

    public static IReadOnlyDictionary<string, string?> ParseVariables(string? json)
        => string.IsNullOrWhiteSpace(json) ? new Dictionary<string, string?>()
            : JsonSerializer.Deserialize<Dictionary<string, string?>>(json) ?? new Dictionary<string, string?>();

    public static string DefaultsJson(IReadOnlyDictionary<string, string> d)
        => JsonSerializer.Serialize(new SortedDictionary<string, string>(d.ToDictionary(k => k.Key, k => k.Value), StringComparer.Ordinal),
            new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

    public static TimeZoneInfo Zone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (TimeZoneNotFoundException) when (id == "Asia/Jerusalem") { return TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time"); }
    }

    public static Task<CampaignRow?> LoadCampaignLockedAsync(SqlConnection c, SqlTransaction tx, Guid tenant, Guid campaignId)
        => c.QuerySingleOrDefaultAsync<CampaignRow>(
            @"SELECT campaign_id AS CampaignId, campaign_state AS CampaignState, created_by AS CreatedBy, department_id AS DepartmentId
              FROM Campaign WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { tenant, campaignId }, tx);

    public static Task<RevisionRow?> LoadCurrentRevisionAsync(SqlConnection c, SqlTransaction? tx, Guid tenant, Guid campaignId)
        => c.QuerySingleOrDefaultAsync<RevisionRow>(
            @"SELECT TOP 1 campaign_revision_id AS CampaignRevisionId, revision_no AS RevisionNo, audience_version_id AS AudienceVersionId,
                     channel AS Channel, content_text AS ContentText, field_defaults_json AS FieldDefaultsJson, scheduled_at AS ScheduledAt
              FROM CampaignRevision WHERE tenant_id = @tenant AND campaign_id = @campaignId ORDER BY revision_no DESC",
            new { tenant, campaignId }, tx);

    public static async Task<PolicyRow> LoadPolicyAsync(SqlConnection c, SqlTransaction? tx, Guid tenant)
        => await c.QuerySingleOrDefaultAsync<PolicyRow>(
            @"SELECT send_window_start AS SendWindowStart, send_window_end AS SendWindowEnd, time_zone AS TimeZone,
                     self_approval_max_recipients AS SelfApprovalMaxRecipients, duplicate_window_days AS DuplicateWindowDays, policy_version AS PolicyVersion
              FROM TenantPolicy WHERE tenant_id = @tenant", new { tenant }, tx) ?? new PolicyRow
            { SendWindowStart = new TimeSpan(8, 0, 0), SendWindowEnd = new TimeSpan(20, 0, 0) };

    public static string Hash(RevisionRow rev, PolicyRow policy)
        => ApprovalPackage.Hash(new ApprovalPackageContent(rev.CampaignRevisionId, rev.AudienceVersionId!.Value, rev.Channel!,
            rev.ContentText!, rev.Defaults, rev.ScheduledAtUtc, policy.PolicyVersion));

    /// <summary>VALID members that have a normalized phone; Suppressed marks SMS suppression entries. Ordered by source row.</summary>
    public static async Task<List<MemberRow>> LoadMembersAsync(SqlConnection c, SqlTransaction? tx, Guid tenant, Guid audienceVersionId)
        => (await c.QueryAsync<MemberRow>(
            @"SELECT m.audience_member_id AS AudienceMemberId, m.approved_identity_key AS ApprovedIdentityKey, m.source_recipient_id AS SourceRecipientId,
                     m.phone_raw AS PhoneRaw, m.phone_normalized AS PhoneNormalized, m.variables_json AS VariablesJson,
                     CAST(CASE WHEN EXISTS (SELECT 1 FROM SuppressionEntry s WHERE s.tenant_id = m.tenant_id AND s.channel = 'SMS'
                                            AND s.destination_normalized = m.phone_normalized) THEN 1 ELSE 0 END AS BIT) AS Suppressed
              FROM AudienceMember m
              WHERE m.tenant_id = @tenant AND m.audience_version_id = @audienceVersionId
                AND m.validation_state = 'VALID' AND m.phone_normalized IS NOT NULL
              ORDER BY m.source_row_number", new { tenant, audienceVersionId }, tx)).ToList();

    private static string NormalizeContent(string s) => System.Text.RegularExpressions.Regex.Replace(s.Trim(), @"\s+", " ");

    private sealed class Candidate
    {
        public Guid? AudienceVersionId { get; set; }
        public string? ContentText { get; set; }
    }

    public static async Task<bool> DuplicateInWindowAsync(SqlConnection c, SqlTransaction? tx, Guid tenant, Guid campaignId, RevisionRow rev, PolicyRow policy, DateTimeOffset now)
    {
        var since = now.UtcDateTime.AddDays(-policy.DuplicateWindowDays);
        var candidates = await c.QueryAsync<Candidate>(
            @"SELECT r.audience_version_id AS AudienceVersionId, r.content_text AS ContentText
              FROM Campaign c JOIN CampaignRevision r ON r.tenant_id = c.tenant_id AND r.campaign_id = c.campaign_id
              WHERE c.tenant_id = @tenant AND c.campaign_state = 'RELEASED' AND c.campaign_id <> @campaignId AND c.updated_at >= @since
                AND r.channel = @channel
                AND r.revision_no = (SELECT MAX(x.revision_no) FROM CampaignRevision x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id)",
            new { tenant, campaignId, since, channel = rev.Channel }, tx);
        var mine = NormalizeContent(rev.ContentText!);
        foreach (var cand in candidates)
        {
            if (cand.ContentText is null || cand.AudienceVersionId is null || NormalizeContent(cand.ContentText) != mine) continue;
            if (cand.AudienceVersionId == rev.AudienceVersionId) return true;
            var differs = await c.ExecuteScalarAsync<int>(
                @"SELECT CASE WHEN EXISTS (SELECT approved_identity_key FROM AudienceMember WHERE tenant_id = @tenant AND audience_version_id = @a AND validation_state = 'VALID'
                                           EXCEPT SELECT approved_identity_key FROM AudienceMember WHERE tenant_id = @tenant AND audience_version_id = @b AND validation_state = 'VALID')
                              OR EXISTS (SELECT approved_identity_key FROM AudienceMember WHERE tenant_id = @tenant AND audience_version_id = @b AND validation_state = 'VALID'
                                         EXCEPT SELECT approved_identity_key FROM AudienceMember WHERE tenant_id = @tenant AND audience_version_id = @a AND validation_state = 'VALID')
                         THEN 1 ELSE 0 END",
                new { tenant, a = rev.AudienceVersionId, b = cand.AudienceVersionId }, tx);
            if (differs == 0) return true;
        }
        return false;
    }

    public static async Task<Evaluation> EvaluateAsync(SqlConnection c, SqlTransaction? tx, Guid tenant, Guid campaignId, RevisionRow rev, PolicyRow policy, DateTimeOffset now)
    {
        var members = (await LoadMembersAsync(c, tx, tenant, rev.AudienceVersionId!.Value)).Where(m => !m.Suppressed).ToList();
        var defaults = rev.Defaults;

        var missing = new List<string>();
        var withMissing = 0;
        var maxSegments = 0; var totalSegments = 0; var ucs2 = false;
        foreach (var m in members)
        {
            var rendered = TemplateRenderer.Render(rev.ContentText!, m.Variables, defaults);
            if (rendered.MissingFields.Count > 0)
            {
                withMissing++;
                foreach (var f in rendered.MissingFields) if (!missing.Contains(f)) missing.Add(f);
            }
            var count = SmsSegments.Count(rendered.Text);
            maxSegments = Math.Max(maxSegments, count.Segments);
            totalSegments += count.Segments;
            ucs2 |= count.Encoding == SmsEncoding.Ucs2;
        }
        if (members.Count == 0)
        {
            var count = SmsSegments.Count(rev.ContentText!);
            maxSegments = count.Segments; ucs2 = count.Encoding == SmsEncoding.Ucs2;
        }

        var previous = await c.QuerySingleOrDefaultAsync<int?>(
            @"SELECT (SELECT COUNT(*) FROM AudienceMember pm
                      WHERE pm.tenant_id = cur.tenant_id AND pm.audience_version_id = prev.audience_version_id
                        AND pm.validation_state = 'VALID' AND pm.phone_normalized IS NOT NULL)
              FROM AudienceVersion cur JOIN AudienceVersion prev
                ON prev.tenant_id = cur.tenant_id AND prev.audience_id = cur.audience_id AND prev.version_no = cur.version_no - 1
              WHERE cur.tenant_id = @tenant AND cur.audience_version_id = @v",
            new { tenant, v = rev.AudienceVersionId }, tx);

        var zone = Zone(policy.TimeZone);
        var local = TimeZoneInfo.ConvertTime(rev.ScheduledAtUtc ?? now, zone);
        var findings = Preflight.Evaluate(new PreflightInput(
            members.Count, missing, withMissing,
            await DuplicateInWindowAsync(c, tx, tenant, campaignId, rev, policy, now),
            previous, local, TimeOnly.FromTimeSpan(policy.SendWindowStart), TimeOnly.FromTimeSpan(policy.SendWindowEnd), CostIsEstimate: true));

        return new Evaluation(findings, members.Count, maxSegments, ucs2 ? "UCS2" : "GSM7",
            totalSegments * CostPerSegmentMin, totalSegments * CostPerSegmentMax, Hash(rev, policy));
    }

    public static FindingDto ToDto(PreflightFinding f)
        => new(f.Code, f.Severity == PreflightSeverity.Blocker ? "BLOCKER" : "WARNING", f.MessageHe, f.Step);
}
