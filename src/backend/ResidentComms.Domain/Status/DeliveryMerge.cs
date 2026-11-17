namespace ResidentComms.Domain.Status;

public readonly record struct DeliveryMergeResult(DeliveryState State, bool Conflict);

/// <summary>
/// Merges an incoming delivery report into the current state by channel rules, not by arrival order
/// (spec §9). Contradicting definite results become Unknown with Conflict=true — no invented certainty.
/// The caller sets DataQuality.Conflicting and keeps every raw event.
/// The caller passes currentlyConflicting: true when the message's DataQuality is Conflicting.
/// A conflict is sticky: while it holds, the result stays Unknown with Conflict=true whatever arrives.
/// Only an explicit reconciliation (a later phase) may clear it.
/// </summary>
public static class DeliveryMerge
{
    public static DeliveryMergeResult Apply(DeliveryState current, DeliveryState incoming, bool currentlyConflicting = false)
    {
        if (currentlyConflicting) return new(DeliveryState.Unknown, true);
        if (current == incoming || incoming == DeliveryState.NotReported) return new(current, false);
        if (current is DeliveryState.NotReported or DeliveryState.Unknown) return new(incoming, false);
        if (incoming == DeliveryState.Unknown) return new(current, false);
        if (current == DeliveryState.SentPerProvider) return new(incoming, false);
        if (incoming == DeliveryState.SentPerProvider) return new(current, false);
        return new(DeliveryState.Unknown, true); // Delivered vs Failed
    }
}
