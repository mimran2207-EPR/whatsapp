using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Status;

public class DeliveryMergeTests
{
    [Fact]
    public void Late_sent_after_delivered_does_not_regress()
        => Assert.Equal(new DeliveryMergeResult(DeliveryState.Delivered, false),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.SentPerProvider));

    [Fact]
    public void Sent_progresses_to_delivered_or_failed()
    {
        Assert.Equal(DeliveryState.Delivered, DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.Delivered).State);
        Assert.Equal(DeliveryState.Failed, DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.Failed).State);
    }

    [Fact]
    public void Duplicate_event_changes_nothing()
        => Assert.Equal(new DeliveryMergeResult(DeliveryState.Delivered, false),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.Delivered));

    [Fact]
    public void Definite_result_replaces_unknown()
        => Assert.Equal(DeliveryState.Delivered,
            DeliveryMerge.Apply(DeliveryState.Unknown, DeliveryState.Delivered).State);

    [Fact]
    public void Unknown_never_overwrites_a_definite_result()
        => Assert.Equal(DeliveryState.Failed,
            DeliveryMerge.Apply(DeliveryState.Failed, DeliveryState.Unknown).State);

    [Fact]
    public void NotReported_incoming_is_ignored()
        => Assert.Equal(DeliveryState.SentPerProvider,
            DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.NotReported).State);

    [Fact]
    public void Delivered_versus_failed_is_flagged_as_conflict_and_unknown()
    {
        Assert.Equal(new DeliveryMergeResult(DeliveryState.Unknown, true),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.Failed));
        Assert.Equal(new DeliveryMergeResult(DeliveryState.Unknown, true),
            DeliveryMerge.Apply(DeliveryState.Failed, DeliveryState.Delivered));
    }
}
