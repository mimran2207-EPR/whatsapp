using ResidentComms.Domain.Content;
namespace ResidentComms.Domain.Tests.Content;
public class SmsSegmentsTests
{
    [Fact] public void Hebrew_70_chars_is_one_segment() => Assert.Equal(new SmsCount(SmsEncoding.Ucs2, 70, 1), SmsSegments.Count(new string('א', 70)));
    [Fact] public void Hebrew_71_chars_is_two_segments_of_67() => Assert.Equal(2, SmsSegments.Count(new string('א', 71)).Segments);
    [Fact] public void Hebrew_135_chars_is_three_segments() => Assert.Equal(3, SmsSegments.Count(new string('א', 135)).Segments);
    [Fact] public void Latin_160_is_one_gsm_segment() => Assert.Equal(new SmsCount(SmsEncoding.Gsm7, 160, 1), SmsSegments.Count(new string('a', 160)));
    [Fact] public void Latin_161_is_two_gsm_segments() => Assert.Equal(2, SmsSegments.Count(new string('a', 161)).Segments);
    [Fact] public void Empty_text_is_zero_segments() => Assert.Equal(0, SmsSegments.Count("").Segments);
}
