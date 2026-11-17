using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Counting;

public sealed record MessageRow(Guid MessageId, Guid CampaignRecipientId, string Channel, DeliveryState Delivery);
public sealed record DocumentLinkRow(Guid DocumentId, Guid? MessageId);

public sealed record CampaignCounts(
    int Recipients, int Messages, int Documents, int Delivered,
    int Failed, int Unknown, int Pending, int ReachedRecipients);

/// <summary>
/// Counting rules (spec §8, §21.3): each child table is reduced to its own grain before counting.
/// Documents = COUNT DISTINCT document_id. NotReported is Pending, never Failed.
/// </summary>
public static class CampaignCounter
{
    public static CampaignCounts Count(IReadOnlyCollection<MessageRow> messages, IReadOnlyCollection<DocumentLinkRow> documentLinks)
    {
        var distinctMessages = messages.DistinctBy(m => m.MessageId).ToList();
        return new CampaignCounts(
            Recipients: distinctMessages.Select(m => m.CampaignRecipientId).Distinct().Count(),
            Messages: distinctMessages.Count,
            Documents: documentLinks.Select(d => d.DocumentId).Distinct().Count(),
            Delivered: distinctMessages.Count(m => m.Delivery == DeliveryState.Delivered),
            Failed: distinctMessages.Count(m => m.Delivery == DeliveryState.Failed),
            Unknown: distinctMessages.Count(m => m.Delivery == DeliveryState.Unknown),
            Pending: distinctMessages.Count(m => m.Delivery is DeliveryState.NotReported or DeliveryState.SentPerProvider),
            ReachedRecipients: distinctMessages.Where(m => m.Delivery == DeliveryState.Delivered)
                .Select(m => m.CampaignRecipientId).Distinct().Count());
    }
}
