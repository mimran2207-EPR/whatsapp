namespace ResidentComms.Domain.Campaigns;

public enum ApprovalDecision { Allowed, SelfApprovalAboveThreshold, NotApproverRole, StaleRevision }

public static class ApprovalPolicy
{
    public static ApprovalDecision Check(string approverId, bool approverHasRole, IReadOnlyCollection<string> contributorIds, int recipients,
        int selfApprovalMax, string packageHashAtSubmit, string currentPackageHash)
    {
        if (!approverHasRole) return ApprovalDecision.NotApproverRole;
        if (!string.Equals(packageHashAtSubmit, currentPackageHash, StringComparison.Ordinal)) return ApprovalDecision.StaleRevision;
        // contributors = campaign creator + everyone who edited the current revision + whoever submitted it
        if (contributorIds.Contains(approverId, StringComparer.Ordinal) && recipients > selfApprovalMax) return ApprovalDecision.SelfApprovalAboveThreshold;
        return ApprovalDecision.Allowed;
    }
}
