using System.Security.Cryptography;
using System.Text;

namespace ResidentComms.Domain.Campaigns;

/// <summary>Message idempotency key per ADR-004. Excludes revision.</summary>
public static class MessageKey
{
    public static string For(Guid tenantId, Guid campaignId, string approvedIdentityKey, string channel, int sequenceNo)
    {
        var raw = $"{tenantId:D}|{campaignId:D}".ToLowerInvariant() + $"|{approvedIdentityKey}|{channel.ToUpperInvariant()}|{sequenceNo}";
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
    }
}
