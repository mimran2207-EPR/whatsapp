namespace ResidentComms.Domain.Status;

public readonly record struct DeliveryMergeResult(DeliveryState State, bool Conflict);

/// <summary>
/// Merges an incoming delivery report into the current state by channel rules, not by arrival order
/// (spec §9). Contradicting definite results become Unknown with Conflict=true — no invented certainty.
/// The caller sets DataQuality.Conflicting and keeps every raw event.
/// </summary>
public static class DeliveryMerge
{
    public static DeliveryMergeResult Apply(DeliveryState current, DeliveryState incoming)
    {
        if (current == incoming || incoming == DeliveryState.NotReported) return new(current, false);
        if (current is DeliveryState.NotReported or DeliveryState.Unknown) return new(incoming, false);
        if (incoming == DeliveryState.Unknown) return new(current, false);
        if (current == DeliveryState.SentPerProvider) return new(incoming, false);
        if (incoming == DeliveryState.SentPerProvider) return new(current, false);
        return new(DeliveryState.Unknown, true); // Delivered vs Failed
    }
}
