using System.Security.Cryptography;
using System.Text;

namespace ResidentComms.Infrastructure.Events;

/// <summary>HMAC-SHA256 over the raw body (lowercase hex) for the mock SMS provider. Verification is constant-time.</summary>
public static class MockSignature
{
    public const string HeaderName = "X-Mock-Signature";

    public static string Compute(string key, ReadOnlySpan<byte> body)
        => Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), body));

    public static bool Verify(string? key, ReadOnlySpan<byte> body, string? signatureHex)
    {
        if (string.IsNullOrEmpty(key) || string.IsNullOrWhiteSpace(signatureHex)) return false;
        byte[] given;
        try { given = Convert.FromHexString(signatureHex.Trim()); } catch (FormatException) { return false; }
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), body);
        return CryptographicOperations.FixedTimeEquals(expected, given);
    }
}
