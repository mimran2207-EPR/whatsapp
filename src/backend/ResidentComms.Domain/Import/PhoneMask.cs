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
/// Masks personal identifiers in API responses. IDs keep only the last 4 characters ("*****6789");
/// names keep the first word and the initial of the rest ("רונית כ.").
/// </summary>
public static class IdentityMask
{
    public static string MaskId(string? id)
    {
        var s = (id ?? "").Trim();
        return s.Length > 4 ? "*****" + s[^4..] : "*****";
    }

    public static string? MaskName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return name;
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 1 ? parts[0] : parts[0] + " " + parts[1][0] + ".";
    }
}
