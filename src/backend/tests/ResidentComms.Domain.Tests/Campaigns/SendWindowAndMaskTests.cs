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
