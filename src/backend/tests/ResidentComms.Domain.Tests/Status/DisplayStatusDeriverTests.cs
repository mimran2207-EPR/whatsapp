using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Status;

public class DisplayStatusDeriverTests
{
    private static MessageAxes Axes(
        ProcessingState p = ProcessingState.InProgress,
        HandoffState h = HandoffState.NotHandedOff,
        DeliveryState d = DeliveryState.NotReported,
        InteractionFlags? i = null) =>
        new(p, h, d, i ?? new InteractionFlags(), DataQuality.Current);

    [Fact]
    public void Rejected_before_send_wins_over_everything()
        => Assert.Equal(DisplayStatus.RejectedBeforeSend,
            DisplayStatusDeriver.Derive(Axes(p: ProcessingState.RejectedBeforeSend)));

    [Fact]
    public void Canceled_before_handoff_is_canceled()
        => Assert.Equal(DisplayStatus.Canceled,
            DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Canceled)));

    [Fact]
    public void Pending_and_queued_map_to_their_labels()
    {
        Assert.Equal(DisplayStatus.Pending, DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Pending)));
        Assert.Equal(DisplayStatus.Queued, DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Queued)));
    }

    [Fact]
    public void Handed_off_without_answer_is_handed_off_not_accepted()
        => Assert.Equal(DisplayStatus.HandedOff,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.HandedOff)));

    [Fact]
    public void Accepted_without_delivery_report_is_accepted_by_provider()
        => Assert.Equal(DisplayStatus.AcceptedByProvider,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted)));

    [Fact]
    public void Timeout_after_handoff_is_unknown_not_failed()
        => Assert.Equal(DisplayStatus.Unknown,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Unknown)));

    [Fact]
    public void Unknown_delivery_is_unknown()
        => Assert.Equal(DisplayStatus.Unknown,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Unknown)));

    [Fact]
    public void Provider_rejection_is_rejected()
        => Assert.Equal(DisplayStatus.Rejected,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Rejected)));

    [Fact]
    public void Failure_report_is_failed()
        => Assert.Equal(DisplayStatus.Failed,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Failed)));

    [Fact]
    public void Sent_and_delivered_map_to_their_labels()
    {
        Assert.Equal(DisplayStatus.SentPerProvider,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.SentPerProvider)));
        Assert.Equal(DisplayStatus.Delivered,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered)));
    }

    [Fact]
    public void Read_flag_shows_read_and_open_flag_shows_opened()
    {
        var t = DateTimeOffset.Parse("2026-11-17T08:00:00Z");
        Assert.Equal(DisplayStatus.Read, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered, i: new InteractionFlags(ReadAt: t))));
        Assert.Equal(DisplayStatus.Opened, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered, i: new InteractionFlags(OpenedAt: t))));
    }

    [Fact]
    public void Failed_wins_over_interaction_flags()
    {
        var t = DateTimeOffset.Parse("2026-11-17T08:00:00Z");
        Assert.Equal(DisplayStatus.Failed, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Failed, i: new InteractionFlags(ReadAt: t))));
    }

    [Fact]
    public void Every_display_status_has_a_hebrew_label()
    {
        foreach (var s in Enum.GetValues<DisplayStatus>())
            Assert.False(string.IsNullOrWhiteSpace(DisplayStatusLabels.He(s)));
        Assert.Equal(13, Enum.GetValues<DisplayStatus>().Length);
    }
}
