using ResidentComms.Domain.Campaigns;
using ResidentComms.Domain.Import;

namespace ResidentComms.Domain.Tests.Campaigns;

public class SendWindowAndMaskTests
{
    [Theory]
    [InlineData("10:00", true)]
    [InlineData("08:00", true)]
    [InlineData("20:00", false)]
    [InlineData("23:00", false)]
    public void Daytime_window(string time, bool inside)
        => Assert.Equal(inside, SendWindow.Contains(TimeOnly.Parse(time), new TimeOnly(8, 0), new TimeOnly(20, 0)));

    [Theory]
    [InlineData("23:00", true)]
    [InlineData("02:00", true)]
    [InlineData("12:00", false)]
    public void Overnight_window(string time, bool inside)
        => Assert.Equal(inside, SendWindow.Contains(TimeOnly.Parse(time), new TimeOnly(22, 0), new TimeOnly(6, 0)));

    [Theory]
    [InlineData("+972521234567", "052-***-**67")]
    [InlineData("0501234512", "050-***-**12")]
    [InlineData("12", "***")]
    [InlineData(null, "***")]
    public void Phone_is_masked(string? phone, string expected) => Assert.Equal(expected, PhoneMask.Mask(phone));
}

public class IdentityMaskIdTests
{
    [Theory]
    [InlineData("123456789", "*****6789")]   // 9-digit ID: last 4 only
    [InlineData("12345678", "*****678")]
    [InlineData("1234567", "*****567")]
    [InlineData("123456", "*****56")]
    [InlineData("12345", "*****45")]          // 5 chars: never 4 of 5
    [InlineData("1234", "*****")]
    [InlineData("1", "*****")]
    [InlineData("", "*****")]
    [InlineData(null, "*****")]
    public void Never_reveals_half_or_more_of_the_id(string? id, string expected)
        => Assert.Equal(expected, IdentityMask.MaskId(id));

    [Fact]
    public void Revealed_suffix_is_always_less_than_half_of_the_trimmed_id()
    {
        for (var len = 1; len <= 40; len++)
        {
            var id = new string('7', len);
            var shown = IdentityMask.MaskId(id).Count(ch => ch == '7');
            Assert.True(shown * 2 < len, $"len {len}: {shown} chars shown");
        }
    }
}
