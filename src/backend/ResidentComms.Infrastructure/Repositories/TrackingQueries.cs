using Dapper;
using ResidentComms.Domain.Import;
using ResidentComms.Domain.Status;
using ResidentComms.Infrastructure.Messaging;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Repositories;

public sealed record TrackingKpi(string Key, decimal? Value, int Numerator, int Denominator);
public sealed record TrackingException(Guid MessageId, string RecipientMasked, string DisplayStatus, string DisplayLabelHe, string? LastAttempt, string NextActionHe);
public sealed record TrackingView(
    string Environment, DateTimeOffset DataAsOf, int Messages,
    Dictionary<string, int> Delivery, Dictionary<string, int> Handoff,
    IReadOnlyList<TrackingKpi> Kpis, string BannerHe, IReadOnlyList<TrackingException> Exceptions);

/// <summary>Tracking read model: counts by axis (never by display label); operational rate over handed-off messages.</summary>
public sealed class TrackingQueries(SqlConnectionFactory db, TimeProvider clock)
{
    private sealed record Row(Guid MessageId, string Destination, string Processing, string Handoff, string Delivery, string Quality, DateTime? ReadAt, DateTime? OpenedAt,
        int? AttemptNumber, string? AttemptOutcome, string? AttemptError);

    private sealed record Counts(int Total, int Delivered, int SentOrNotReported, int DUnknown, int Failed, int Accepted, int Rejected, int HUnknown, int NotHandedOff);

    public async Task<TrackingView?> GetAsync(Guid tenant, Guid campaignId, CancellationToken ct = default)
    {
        await using var c = await db.OpenAsync(ct);
        if (await c.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM Campaign WHERE tenant_id = @tenant AND campaign_id = @campaignId", new { tenant, campaignId }, cancellationToken: ct)) == 0)
            return null;

        // Delivery buckets come from the same expression as the campaign list (MessageBuckets): a timeout (handoff UNKNOWN) is "unknown",
        // a provider rejection is "failed", never "sent or not reported".
        var k = await c.QuerySingleAsync<Counts>(new CommandDefinition(
            $@"SELECT COUNT(*) AS Total,
                     COALESCE(SUM(CASE WHEN {MessageBuckets.Sql("Message")} = '{MessageBuckets.Delivered}' THEN 1 ELSE 0 END), 0) AS Delivered,
                     COALESCE(SUM(CASE WHEN {MessageBuckets.Sql("Message")} IN ('{MessageBuckets.Sent}','{MessageBuckets.NotReported}') THEN 1 ELSE 0 END), 0) AS SentOrNotReported,
                     COALESCE(SUM(CASE WHEN {MessageBuckets.Sql("Message")} = '{MessageBuckets.Unknown}' THEN 1 ELSE 0 END), 0) AS DUnknown,
                     COALESCE(SUM(CASE WHEN {MessageBuckets.Sql("Message")} = '{MessageBuckets.Failed}' THEN 1 ELSE 0 END), 0) AS Failed,
                     COALESCE(SUM(CASE WHEN handoff_state = 'ACCEPTED' THEN 1 ELSE 0 END), 0) AS Accepted,
                     COALESCE(SUM(CASE WHEN handoff_state = 'REJECTED' THEN 1 ELSE 0 END), 0) AS Rejected,
                     COALESCE(SUM(CASE WHEN handoff_state = 'UNKNOWN' THEN 1 ELSE 0 END), 0) AS HUnknown,
                     COALESCE(SUM(CASE WHEN handoff_state = 'NOT_HANDED_OFF' THEN 1 ELSE 0 END), 0) AS NotHandedOff
              FROM Message WHERE tenant_id = @tenant AND campaign_id = @campaignId",
            new { tenant, campaignId }, cancellationToken: ct));

        // dataAsOf = the latest provider event received for this campaign (not "now"); with no events yet, the current time.
        var asOf = await c.ExecuteScalarAsync<DateTime?>(new CommandDefinition(
            "SELECT MAX(e.received_at) FROM MessageEvent e JOIN Message m ON m.tenant_id = e.tenant_id AND m.message_id = e.message_id WHERE m.tenant_id = @tenant AND m.campaign_id = @campaignId",
            new { tenant, campaignId }, cancellationToken: ct));
        var dataAsOf = asOf is null ? clock.GetUtcNow() : new DateTimeOffset(DateTime.SpecifyKind(asOf.Value, DateTimeKind.Utc));

        var handedOff = k.Total - k.NotHandedOff; // denominator: pending and unknown stay in

        // Candidates for the exception list; the final filter is the display status from the deriver.
        var rows = (await c.QueryAsync<Row>(new CommandDefinition(
            @"SELECT m.message_id AS MessageId, m.destination_value AS Destination, m.processing_state AS Processing, m.handoff_state AS Handoff,
                     m.delivery_state AS Delivery, m.data_quality AS Quality, m.read_at AS ReadAt, m.opened_at AS OpenedAt,
                     a.attempt_number AS AttemptNumber, a.attempt_outcome AS AttemptOutcome, a.provider_error_code AS AttemptError
              FROM Message m
              OUTER APPLY (SELECT TOP 1 * FROM SendAttempt s WHERE s.tenant_id = m.tenant_id AND s.message_id = m.message_id ORDER BY s.attempt_number DESC) a
              WHERE m.tenant_id = @tenant AND m.campaign_id = @campaignId
                AND (m.delivery_state IN ('FAILED','UNKNOWN') OR m.handoff_state IN ('REJECTED','UNKNOWN') OR m.processing_state = 'REJECTED_BEFORE_SEND')
              ORDER BY m.created_at, m.message_id",
            new { tenant, campaignId }, cancellationToken: ct))).ToList();

        var exceptions = new List<TrackingException>();
        foreach (var r in rows)
        {
            var status = DisplayStatusDeriver.Derive(new MessageAxes(
                StatusMapper.FromDb<ProcessingState>(r.Processing), StatusMapper.FromDb<HandoffState>(r.Handoff), StatusMapper.FromDb<DeliveryState>(r.Delivery),
                new InteractionFlags(ReadAt: Utc(r.ReadAt), OpenedAt: Utc(r.OpenedAt)), StatusMapper.FromDb<DataQuality>(r.Quality)));
            if (status is not (DisplayStatus.Unknown or DisplayStatus.Failed or DisplayStatus.Rejected or DisplayStatus.RejectedBeforeSend)) continue;
            exceptions.Add(new TrackingException(r.MessageId, PhoneMask.Mask(r.Destination), status.ToString(), DisplayStatusLabels.He(status), LastAttempt(r), NextAction(status)));
            if (exceptions.Count == 50) break;
        }

        return new TrackingView(
            "sandbox-mock", dataAsOf, k.Total,
            new() { ["delivered"] = k.Delivered, ["sentOrNotReported"] = k.SentOrNotReported, ["unknown"] = k.DUnknown, ["failed"] = k.Failed },
            new() { ["accepted"] = k.Accepted, ["rejected"] = k.Rejected, ["unknown"] = k.HUnknown, ["notHandedOff"] = k.NotHandedOff },
            [
                new TrackingKpi("accepted", k.Accepted, k.Accepted, k.Total),
                new TrackingKpi("operationalDeliveryRate", handedOff == 0 ? null : Math.Round((decimal)k.Delivered / handedOff, 4), k.Delivered, handedOff),
            ],
            $"{k.Accepted} הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.",
            exceptions);
    }

    private static DateTimeOffset? Utc(DateTime? d) => d is null ? null : new DateTimeOffset(DateTime.SpecifyKind(d.Value, DateTimeKind.Utc));

    private static string? LastAttempt(Row r)
    {
        if (r.AttemptNumber is null) return null;
        var outcome = r.AttemptOutcome switch
        {
            "AMBIGUOUS" => "Timeout", "REJECTED" => "Rejected", "ACCEPTED" => "Accepted", "LOCAL_FAILURE" => "LocalFailure", null => "InFlight", var o => o,
        };
        return $"ניסיון {r.AttemptNumber} · {outcome}" + (string.IsNullOrEmpty(r.AttemptError) ? "" : $" ({r.AttemptError})");
    }

    private static string NextAction(DisplayStatus s) => s switch
    {
        DisplayStatus.Unknown => "בירור",
        DisplayStatus.Failed => "בדיקת יעד ושליחה חוזרת מבוקרת",
        DisplayStatus.Rejected => "בדיקת סיבת הדחייה",
        _ => "תיקון נתונים",
    };
}
