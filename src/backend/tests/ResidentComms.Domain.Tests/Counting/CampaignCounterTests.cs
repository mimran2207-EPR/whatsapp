using ResidentComms.Domain.Counting;
using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Counting;

public class CampaignCounterTests
{
    private static readonly Guid R1 = Guid.NewGuid(), R2 = Guid.NewGuid(), R3 = Guid.NewGuid();
    private static readonly Guid M1 = Guid.NewGuid(), M2 = Guid.NewGuid(), M3 = Guid.NewGuid(), M4 = Guid.NewGuid(), M5 = Guid.NewGuid();
    private static readonly Guid D1 = Guid.NewGuid(), D2 = Guid.NewGuid(), D3 = Guid.NewGuid(), D4 = Guid.NewGuid();

    [Fact]
    public void Truth_book_01_matches()
    {
        var messages = new[]
        {
            new MessageRow(M1, R1, "WHATSAPP", DeliveryState.Delivered),
            new MessageRow(M2, R1, "SMS", DeliveryState.Delivered),
            new MessageRow(M3, R1, "EMAIL", DeliveryState.NotReported),
            new MessageRow(M4, R2, "SMS", DeliveryState.Failed),
            new MessageRow(M5, R3, "SMS", DeliveryState.Unknown),
        };
        var docs = new[]
        {
            new DocumentLinkRow(D1, M1), new DocumentLinkRow(D1, M2), new DocumentLinkRow(D1, M3),
            new DocumentLinkRow(D2, M1), new DocumentLinkRow(D3, M4), new DocumentLinkRow(D4, null),
        };

        var c = CampaignCounter.Count(messages, docs);

        Assert.Equal(new CampaignCounts(Recipients: 3, Messages: 5, Documents: 4, Delivered: 2,
            Failed: 1, Unknown: 1, Pending: 1, ReachedRecipients: 1), c);
    }

    [Fact]
    public void One_recipient_three_channels_three_documents_each()
    {
        var msgs = new[] { M1, M2, M3 }.Select((m, i) =>
            new MessageRow(m, R1, new[] { "WHATSAPP", "SMS", "EMAIL" }[i], DeliveryState.Delivered)).ToArray();
        var docs = new[] { D1, D2, D3 }.SelectMany(d => msgs.Select(m => new DocumentLinkRow(d, m.MessageId))).ToArray();

        var c = CampaignCounter.Count(msgs, docs);

        Assert.Equal(1, c.Recipients);
        Assert.Equal(3, c.Messages);
        Assert.Equal(3, c.Documents);
    }
}
