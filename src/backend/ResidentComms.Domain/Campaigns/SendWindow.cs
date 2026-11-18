namespace ResidentComms.Domain.Campaigns;

/// <summary>Tenant send window (local time). Start == end means "always"; start &gt; end is an overnight window.</summary>
public static class SendWindow
{
    public static bool Contains(TimeOnly t, TimeOnly start, TimeOnly end)
        => start == end || (start < end ? t >= start && t < end : t >= start || t < end);
}
