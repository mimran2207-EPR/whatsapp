namespace ResidentComms.Domain.Content;
public enum SmsEncoding { Gsm7, Ucs2 }
public sealed record SmsCount(SmsEncoding Encoding, int Characters, int Segments);

/// <summary>Estimate only — verify with the chosen provider (spec §6). GSM-7 basic set approximated as ASCII printable.</summary>
public static class SmsSegments
{
    public static SmsCount Count(string text)
    {
        var len = text.Length;
        var gsm = text.All(c => c is >= ' ' and <= '~' or '\n' or '\r');
        var (single, multi) = gsm ? (160, 153) : (70, 67);
        var segments = len == 0 ? 0 : len <= single ? 1 : (int)Math.Ceiling(len / (double)multi);
        return new(gsm ? SmsEncoding.Gsm7 : SmsEncoding.Ucs2, len, segments);
    }
}
