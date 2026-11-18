using System.Text.Json;
using Dapper;
using ResidentComms.Domain.Content;
using ResidentComms.Domain.Import;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Repositories;

public sealed record CampaignAudienceDto(
    Guid AudienceVersionId, Guid? ImportRunId, string? FileName, int RowCount, int ValidCount, int InvalidCount, int EligibleRecipients,
    IReadOnlyList<string> FieldNames);

/// <summary>First eligible recipient, rendered by the server's TemplateRenderer. Identity is masked; the name is masked inside the text too.</summary>
public sealed record CampaignPreviewDto(string? RecipientName, string RecipientPhone, string Text, IReadOnlyList<string> MissingFields);

public sealed record CampaignDetail(
    Guid CampaignId, string Name, string Purpose, string State, string CreatedBy, Guid RevisionId, int RevisionNo,
    string? Channel, string? ContentText, IReadOnlyDictionary<string, string> FieldDefaults, DateTimeOffset? ScheduledAt,
    CampaignAudienceDto? Audience, CampaignPreviewDto? Preview);

public sealed record ApprovedListItem(Guid CampaignId, string Name, string Purpose, string SubmittedBy, string? Channel, int Recipients, string ApprovedBy, DateTimeOffset ApprovedAt);

/// <summary>Read side for one campaign (draft resume, approver preview) and the "approved, not yet released" queue. All queries filter by tenant.</summary>
public sealed class CampaignDetailRepository(SqlConnectionFactory db)
{
    private sealed record Head(string Name, string Purpose, string State, string CreatedBy);
    private sealed record Run(Guid ImportRunId, string FileName, int RowCount, int ValidCount);
    private sealed record First(string? RecipientName, string PhoneNormalized, string? VariablesJson);

    public async Task<CampaignDetail?> GetAsync(Guid tenant, Guid campaignId)
    {
        await using var c = await db.OpenAsync();
        var head = await c.QuerySingleOrDefaultAsync<Head>(
            @"SELECT campaign_name AS Name, communication_purpose AS Purpose, campaign_state AS State, created_by AS CreatedBy
              FROM Campaign WHERE tenant_id = @tenant AND campaign_id = @campaignId", new { tenant, campaignId });
        if (head is null) return null;
        var rev = await CampaignQueries.LoadCurrentRevisionAsync(c, null, tenant, campaignId);
        if (rev is null) return null;

        CampaignAudienceDto? audience = null;
        CampaignPreviewDto? preview = null;
        if (rev.AudienceVersionId is { } av)
        {
            var run = await c.QuerySingleOrDefaultAsync<Run>(
                @"SELECT TOP 1 import_run_id AS ImportRunId, source_object_name AS FileName, row_count AS [RowCount], valid_count AS ValidCount
                  FROM ImportRun WHERE tenant_id = @tenant AND audience_version_id = @av ORDER BY created_at DESC", new { tenant, av });
            var eligible = (await CampaignQueries.LoadMembersAsync(c, null, tenant, av)).Count(m => !m.Suppressed);
            var anyVars = await c.QuerySingleOrDefaultAsync<string?>(
                "SELECT TOP 1 variables_json FROM AudienceMember WHERE tenant_id = @tenant AND audience_version_id = @av ORDER BY source_row_number",
                new { tenant, av });
            var fields = CampaignQueries.ParseVariables(anyVars).Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
            audience = new CampaignAudienceDto(av, run?.ImportRunId, run?.FileName, run?.RowCount ?? 0, run?.ValidCount ?? 0,
                (run?.RowCount ?? 0) - (run?.ValidCount ?? 0), eligible, fields);

            if (!string.IsNullOrWhiteSpace(rev.ContentText))
            {
                var first = await c.QuerySingleOrDefaultAsync<First>(
                    @"SELECT TOP 1 m.recipient_name AS RecipientName, m.phone_normalized AS PhoneNormalized, m.variables_json AS VariablesJson
                      FROM AudienceMember m
                      WHERE m.tenant_id = @tenant AND m.audience_version_id = @av AND m.validation_state = 'VALID' AND m.phone_normalized IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM SuppressionEntry s WHERE s.tenant_id = m.tenant_id AND s.channel = 'SMS' AND s.destination_normalized = m.phone_normalized)
                      ORDER BY m.source_row_number", new { tenant, av });
                if (first is not null)
                {
                    var masked = SafeName(first.RecipientName);
                    // The name column is also stored as a variable (raw cell: untrimmed, not truncated to 200). Substitute the masked
                    // value for it BEFORE rendering, matching on the normalised text, so the rendered message never carries the raw name.
                    var values = CampaignQueries.ParseVariables(first.VariablesJson).ToDictionary(
                        kv => kv.Key,
                        kv => IsNameValue(kv.Value, first.RecipientName) ? SafeName(kv.Value) : kv.Value);
                    var r = TemplateRenderer.Render(rev.ContentText, values, rev.Defaults);
                    preview = new CampaignPreviewDto(masked, PhoneMask.Mask(first.PhoneNormalized), r.Text, r.MissingFields);
                }
            }
        }

        return new CampaignDetail(campaignId, head.Name, head.Purpose, head.State, head.CreatedBy, rev.CampaignRevisionId, rev.RevisionNo,
            rev.Channel, rev.ContentText, rev.Defaults, rev.ScheduledAtUtc, audience, preview);
    }

    private static string Normalize(string s) => System.Text.RegularExpressions.Regex.Replace(s.Trim(), @"\s+", " ");

    /// <summary>
    /// True when a variable value is the recipient's name: equal after trimming and collapsing whitespace, or, because
    /// recipient_name is cut at 200 characters while the variable is not, when the variable starts with the stored (cut) name.
    /// </summary>
    internal static bool IsNameValue(string? value, string? recipientName)
    {
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(recipientName)) return false;
        var v = Normalize(value); var n = Normalize(recipientName);
        return v == n || (recipientName.Length >= 200 && v.StartsWith(n, StringComparison.Ordinal));
    }

    private const int MaxMaskedNameLength = 24;

    /// <summary>IdentityMask.MaskName on the normalised value, capped so a single very long word is never shown whole.</summary>
    internal static string? SafeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return name;
        var m = IdentityMask.MaskName(Normalize(name))!;
        return m.Length <= MaxMaskedNameLength ? m : m[..MaxMaskedNameLength] + "…";
    }

    private sealed record ApprovedRow(Guid CampaignId, string Name, string Purpose, string CreatedBy, string? Channel, int Recipients, string DecidedBy, DateTime DecidedAt);

    /// <summary>APPROVED (not yet RELEASED) campaigns of the department with a still-valid approval: the approver's release queue.</summary>
    public async Task<IReadOnlyList<ApprovedListItem>> ListApprovedAsync(Guid tenant, string department)
    {
        await using var c = await db.OpenAsync();
        var rows = await c.QueryAsync<ApprovedRow>(
            @"SELECT c.campaign_id AS CampaignId, c.campaign_name AS Name, c.communication_purpose AS Purpose, c.created_by AS CreatedBy, r.channel AS Channel,
                     (SELECT COUNT(*) FROM AudienceMember m WHERE m.tenant_id = c.tenant_id AND m.audience_version_id = r.audience_version_id
                        AND m.validation_state = 'VALID' AND m.phone_normalized IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM SuppressionEntry s WHERE s.tenant_id = m.tenant_id AND s.channel = 'SMS' AND s.destination_normalized = m.phone_normalized)) AS Recipients,
                     a.decided_by AS DecidedBy, a.decided_at AS DecidedAt
              FROM Campaign c
              JOIN CampaignRevision r ON r.tenant_id = c.tenant_id AND r.campaign_id = c.campaign_id
               AND r.revision_no = (SELECT MAX(x.revision_no) FROM CampaignRevision x WHERE x.tenant_id = c.tenant_id AND x.campaign_id = c.campaign_id)
              CROSS APPLY (SELECT TOP 1 ap.decided_by, ap.decided_at FROM Approval ap
                           WHERE ap.tenant_id = c.tenant_id AND ap.campaign_revision_id = r.campaign_revision_id
                             AND ap.decision = 'APPROVED' AND ap.invalidated_at IS NULL ORDER BY ap.decided_at DESC) a
              WHERE c.tenant_id = @tenant AND c.department_id = @department AND c.campaign_state = 'APPROVED'
              ORDER BY a.decided_at", new { tenant, department });
        return rows.Select(r => new ApprovedListItem(r.CampaignId, r.Name, r.Purpose, r.CreatedBy, r.Channel, r.Recipients, r.DecidedBy,
            new DateTimeOffset(DateTime.SpecifyKind(r.DecidedAt, DateTimeKind.Utc)))).ToList();
    }
}
