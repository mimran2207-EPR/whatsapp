namespace ResidentComms.Domain.Campaigns;

public enum ApprovalDecision { Allowed, SelfApprovalAboveThreshold, NotApproverRole, StaleRevision }

public static class ApprovalPolicy
{
    public static ApprovalDecision Check(string approverId, bool approverHasRole, string creatorId, int recipients,
        int selfApprovalMax, string packageHashAtSubmit, string currentPackageHash)
    {
        if (!approverHasRole) return ApprovalDecision.NotApproverRole;
        if (!string.Equals(packageHashAtSubmit, currentPackageHash, StringComparison.Ordinal)) return ApprovalDecision.StaleRevision;
        if (approverId == creatorId && recipients > selfApprovalMax) return ApprovalDecision.SelfApprovalAboveThreshold;
        return ApprovalDecision.Allowed;
    }
}
