using System.Text.RegularExpressions;
namespace ResidentComms.Domain.Import;

[Flags] public enum PhoneIssue { None = 0, Empty = 1, ScientificNotation = 2, LostLeadingZero = 4, InvalidLength = 8, NotMobile = 16, NonDigits = 32 }

public sealed record PhoneResult(string? Raw, string? Normalized, PhoneIssue Issues) { public bool IsValidMobile => Normalized is not null; }

/// <summary>Israeli mobile → E.164. Never restores lost digits (spec §5); syntactic validity is not proof of ownership.</summary>
public static partial class PhoneNormalizer
{
    [GeneratedRegex(@"^\d(\.\d+)?E\+\d+$", RegexOptions.IgnoreCase)] private static partial Regex Scientific();

    public static PhoneResult NormalizeIsraeliMobile(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new(raw, null, PhoneIssue.Empty);
        var trimmed = raw.Trim();
        if (Scientific().IsMatch(trimmed)) return new(raw, null, PhoneIssue.ScientificNotation);
        var compact = trimmed.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "");
        if (compact.StartsWith('+')) compact = compact[1..];
        if (!compact.All(char.IsAsciiDigit)) return new(raw, null, PhoneIssue.NonDigits);
        string national;
        if (compact.StartsWith("972")) national = "0" + compact[3..];
        else if (compact.Length == 9 && compact[0] == '5') return new(raw, null, PhoneIssue.LostLeadingZero);
        else if (compact.Length == 9 && compact[0] == '0') return new(raw, null, PhoneIssue.NotMobile);
        else national = compact;
        if (national.Length != 10) return new(raw, null, PhoneIssue.InvalidLength);
        if (!national.StartsWith("05")) return new(raw, null, PhoneIssue.NotMobile);
        return new(raw, "+972" + national[1..], PhoneIssue.None);
    }
}
