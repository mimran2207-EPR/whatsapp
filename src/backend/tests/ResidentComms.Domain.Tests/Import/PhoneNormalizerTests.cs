using ResidentComms.Domain.Import;
namespace ResidentComms.Domain.Tests.Import;
public class PhoneNormalizerTests
{
    [Theory]
    [InlineData("052-1234567", "+972521234567")]
    [InlineData("0521234567", "+972521234567")]
    [InlineData("+972 52 123 4567", "+972521234567")]
    [InlineData("972521234567", "+972521234567")]
    public void Normalizes_valid_israeli_mobiles(string raw, string expected)
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile(raw);
        Assert.Equal(expected, r.Normalized);
        Assert.Equal(raw, r.Raw);
        Assert.Equal(PhoneIssue.None, r.Issues);
    }

    [Theory]
    [InlineData(" 052-1234567")]          // NBSP (copied from Excel / web pages)
    [InlineData("052 1234567 ")]
    [InlineData("‎0521234567‎")]     // LRM
    [InlineData("‏+972521234567‏")]  // RLM
    [InlineData("052	1234567")]               // tab
    [InlineData(" 052 123 4567")]         // narrow NBSP
    [InlineData("‪052-1234567‬")]    // LRE ... PDF
    [InlineData("+9720521234567")]              // trunk zero kept after the country code
    [InlineData("9720521234567")]
    [InlineData("+972 (0) 52-123-4567")]
    public void Invisible_bidi_and_whitespace_characters_and_trunk_zero_are_tolerated(string raw)
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile(raw);
        Assert.Equal("+972521234567", r.Normalized);
        Assert.Equal(PhoneIssue.None, r.Issues);
        Assert.Equal(raw, r.Raw);
    }

    [Theory]
    [InlineData("‎")]
    [InlineData(" ")]
    public void Only_invisible_characters_is_empty(string raw)
        => Assert.Equal(PhoneIssue.Empty, PhoneNormalizer.NormalizeIsraeliMobile(raw).Issues);

    [Fact]
    public void Lost_leading_zero_is_flagged_not_restored()
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile("521234567");
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(PhoneIssue.LostLeadingZero));
    }

    [Fact]
    public void Scientific_notation_is_flagged()
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile("5.21234567E+08");
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(PhoneIssue.ScientificNotation));
    }

    [Theory]
    [InlineData("", PhoneIssue.Empty)]
    [InlineData(null, PhoneIssue.Empty)]
    [InlineData("052-123", PhoneIssue.InvalidLength)]
    [InlineData("03-6123456", PhoneIssue.NotMobile)]
    [InlineData("05x1234567", PhoneIssue.NonDigits)]
    public void Invalid_inputs_are_flagged(string? raw, PhoneIssue issue)
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile(raw);
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(issue));
    }
}
