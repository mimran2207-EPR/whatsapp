namespace ResidentComms.Infrastructure.Repositories;

/// <summary>
/// ONE definition of the delivery bucket of a message, used by the campaign list and the tracking summary so they can never disagree.
/// It follows the precedence of DisplayStatusDeriver: FAILED (delivery failed or provider rejected the hand-off) wins over DELIVERED,
/// then SENT, then UNKNOWN (delivery unknown or the hand-off outcome unknown, e.g. a timeout), otherwise NOT_REPORTED.
/// </summary>
internal static class MessageBuckets
{
    public const string Failed = "FAILED", Delivered = "DELIVERED", Sent = "SENT", Unknown = "UNKNOWN", NotReported = "NOT_REPORTED";

    public static string Sql(string alias) => $@"CASE
        WHEN {alias}.delivery_state = 'FAILED' OR {alias}.handoff_state = 'REJECTED' THEN '{Failed}'
        WHEN {alias}.delivery_state = 'DELIVERED' THEN '{Delivered}'
        WHEN {alias}.delivery_state = 'SENT_PER_PROVIDER' THEN '{Sent}'
        WHEN {alias}.delivery_state = 'UNKNOWN' OR {alias}.handoff_state = 'UNKNOWN' THEN '{Unknown}'
        ELSE '{NotReported}' END";
}
