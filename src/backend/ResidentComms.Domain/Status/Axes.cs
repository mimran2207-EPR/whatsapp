namespace ResidentComms.Domain.Status;

/// <summary>Internal processing axis (spec §9).</summary>
public enum ProcessingState { RejectedBeforeSend, Pending, Queued, InProgress, Canceled }

/// <summary>Hand-off-to-provider axis. Unknown = request may have reached the provider but no answer.</summary>
public enum HandoffState { NotHandedOff, HandedOff, Accepted, Rejected, Unknown }

/// <summary>Delivery axis. NotReported is not failure.</summary>
public enum DeliveryState { NotReported, SentPerProvider, Delivered, Failed, Unknown }

/// <summary>Information-quality axis.</summary>
public enum DataQuality { Current, Partial, Late, Conflicting, Unsupported }

/// <summary>Interaction flags with timestamps. A null flag means "no event", never "did not happen".</summary>
public sealed record InteractionFlags(
    DateTimeOffset? ReadAt = null,
    DateTimeOffset? OpenedAt = null,
    DateTimeOffset? ClickedAt = null,
    DateTimeOffset? RepliedAt = null,
    DateTimeOffset? OptedOutAt = null);

public sealed record MessageAxes(
    ProcessingState Processing,
    HandoffState Handoff,
    DeliveryState Delivery,
    InteractionFlags Interaction,
    DataQuality Quality);
