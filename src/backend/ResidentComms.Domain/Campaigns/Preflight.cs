namespace ResidentComms.Domain.Campaigns;

public enum PreflightSeverity { Blocker, Warning }

public sealed record PreflightFinding(string Code, PreflightSeverity Severity, string MessageHe, string Step);

public sealed record PreflightInput(
    int EligibleRecipients,
    IReadOnlyList<string> MissingFields,
    int RecipientsWithMissingFields,
    bool DuplicateInWindow,
    int? PreviousAudienceSize,
    DateTimeOffset ScheduledAtLocal,
    TimeOnly WindowStart,
    TimeOnly WindowEnd,
    bool CostIsEstimate);

public static class Preflight
{
    public static IReadOnlyList<PreflightFinding> Evaluate(PreflightInput i)
    {
        var findings = new List<PreflightFinding>();

        if (i.EligibleRecipients <= 0)
            findings.Add(new("NO_ELIGIBLE", PreflightSeverity.Blocker, "אין נמענים זכאים לשליחה", "למי"));

        if (i.MissingFields.Count > 0)
            findings.Add(new("MISSING_FIELD", PreflightSeverity.Blocker,
                $"שדה דינמי חסר: \"{string.Join(", ", i.MissingFields)}\" ב-{i.RecipientsWithMissingFields} נמענים", "מה"));

        if (i.DuplicateInWindow)
            findings.Add(new("DUPLICATE_SEND", PreflightSeverity.Blocker, "קיים משלוח זהה באותו חלון זמן", "בדיקה"));

        if (i.PreviousAudienceSize is > 0 and var prev
            && Math.Abs(i.EligibleRecipients - prev) / (double)prev >= 0.05)
        {
            var pct = (i.EligibleRecipients - prev) / (double)prev * 100;
            findings.Add(new("AUDIENCE_SIZE_CHANGE", PreflightSeverity.Warning,
                $"שינוי חריג בגודל הקהל: {pct:+0;-0}% מול הגרסה הקודמת", "למי"));
        }

        var t = TimeOnly.FromDateTime(i.ScheduledAtLocal.DateTime);
        if (t < i.WindowStart || t >= i.WindowEnd)
            findings.Add(new("OUTSIDE_SEND_WINDOW", PreflightSeverity.Warning, "מועד השליחה מחוץ לחלון השליחה המותר", "אישור ושליחה"));

        if (i.CostIsEstimate)
            findings.Add(new("COST_ESTIMATE_ONLY", PreflightSeverity.Warning, "העלות המוצגת היא הערכה בלבד", "איך"));

        return findings;
    }
}
