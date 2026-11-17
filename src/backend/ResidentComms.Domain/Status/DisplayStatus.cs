namespace ResidentComms.Domain.Status;

/// <summary>The 13 display labels (spec §9). Presentation helper only; never replaces the axes.</summary>
public enum DisplayStatus
{
    RejectedBeforeSend, Pending, Queued, HandedOff, AcceptedByProvider, SentPerProvider,
    Delivered, Read, Opened, Failed, Rejected, Canceled, Unknown
}

public static class DisplayStatusLabels
{
    public static string He(DisplayStatus status) => status switch
    {
        DisplayStatus.RejectedBeforeSend => "נפסל לפני שליחה",
        DisplayStatus.Pending => "ממתין",
        DisplayStatus.Queued => "בתור",
        DisplayStatus.HandedOff => "הועבר לספק",
        DisplayStatus.AcceptedByProvider => "התקבל אצל הספק",
        DisplayStatus.SentPerProvider => "נשלח לפי הספק",
        DisplayStatus.Delivered => "נמסר",
        DisplayStatus.Read => "נקרא",
        DisplayStatus.Opened => "נפתח",
        DisplayStatus.Failed => "נכשל",
        DisplayStatus.Rejected => "נדחה",
        DisplayStatus.Canceled => "בוטל",
        DisplayStatus.Unknown => "לא ידוע",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };
}
