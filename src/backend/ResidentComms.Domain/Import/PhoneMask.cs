namespace ResidentComms.Domain.Import;

/// <summary>Masks a phone for API responses: "+972521234567" or "0521234567" becomes "052-***-**67".</summary>
public static class PhoneMask
{
    public static string Mask(string? phone)
    {
        var digits = new string((phone ?? "").Where(char.IsAsciiDigit).ToArray());
        if (digits.StartsWith("972")) digits = "0" + digits[3..];
        return digits.Length >= 5 ? $"{digits[..3]}-***-**{digits[^2..]}" : "***";
    }
}

/// <summary>
/// Masks personal identifiers in API responses. IDs keep at most the last 4 characters (fewer for short IDs, always under half) ("*****6789");
/// names keep the first word and the initial of the rest ("רונית כ.").
/// </summary>
public static class IdentityMask
{
    public static string MaskId(string? id)
    {
        var s = (id ?? "").Trim();
        // Never reveal half or more of the ID (a 5-character ID must not show 4 of its 5 characters); at most 4.
        var shown = s.Length <= 4 ? 0 : Math.Min(4, (s.Length - 1) / 2);
        return shown > 0 ? "*****" + s[^shown..] : "*****";
    }

    public static string? MaskName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return name;
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 1 ? parts[0] : parts[0] + " " + parts[1][0] + ".";
    }
}
