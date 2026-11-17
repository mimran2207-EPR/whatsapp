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
