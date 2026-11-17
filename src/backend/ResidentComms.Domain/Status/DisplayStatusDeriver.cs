namespace ResidentComms.Domain.Status;

/// <summary>
/// Derives the single display label from the five axes. The order below is the contract;
/// it is documented in docs/status-dictionary.md and must stay in sync with it.
/// </summary>
public static class DisplayStatusDeriver
{
    public static DisplayStatus Derive(MessageAxes a)
    {
        if (a.Processing == ProcessingState.RejectedBeforeSend) return DisplayStatus.RejectedBeforeSend;
        if (a.Processing == ProcessingState.Canceled && a.Handoff == HandoffState.NotHandedOff)
            return DisplayStatus.Canceled;
        if (a.Delivery == DeliveryState.Failed) return DisplayStatus.Failed;
        if (a.Handoff == HandoffState.Rejected) return DisplayStatus.Rejected;
        if (a.Interaction.ReadAt is not null) return DisplayStatus.Read;
        if (a.Interaction.OpenedAt is not null) return DisplayStatus.Opened;
        if (a.Delivery == DeliveryState.Delivered) return DisplayStatus.Delivered;
        if (a.Delivery == DeliveryState.SentPerProvider) return DisplayStatus.SentPerProvider;
        if (a.Delivery == DeliveryState.Unknown || a.Handoff == HandoffState.Unknown) return DisplayStatus.Unknown;
        if (a.Handoff == HandoffState.Accepted) return DisplayStatus.AcceptedByProvider;
        if (a.Handoff == HandoffState.HandedOff) return DisplayStatus.HandedOff;
        if (a.Processing is ProcessingState.Queued or ProcessingState.InProgress) return DisplayStatus.Queued;
        return DisplayStatus.Pending;
    }
}
