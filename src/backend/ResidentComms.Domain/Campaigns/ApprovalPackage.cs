using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace ResidentComms.Domain.Campaigns;

public sealed record ApprovalPackageContent(
    Guid CampaignRevisionId,
    Guid AudienceVersionId,
    string Channel,
    string ContentText,
    IReadOnlyDictionary<string, string> FieldDefaults,
    DateTimeOffset? ScheduledAt,
    int PolicyVersion);

public static class ApprovalPackage
{
    private static readonly JsonSerializerOptions Options = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static string Hash(ApprovalPackageContent c)
    {
        var doc = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["audience_version_id"] = c.AudienceVersionId.ToString("D").ToLowerInvariant(),
            ["campaign_revision_id"] = c.CampaignRevisionId.ToString("D").ToLowerInvariant(),
            ["channel"] = c.Channel,
            ["content_text"] = c.ContentText,
            ["field_defaults"] = new SortedDictionary<string, string>(
                c.FieldDefaults.ToDictionary(kv => kv.Key, kv => kv.Value), StringComparer.Ordinal),
            ["policy_version"] = c.PolicyVersion,
            ["scheduled_at"] = c.ScheduledAt?.UtcDateTime.ToString("O"),
        };
        var json = JsonSerializer.Serialize(doc, Options);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
}
