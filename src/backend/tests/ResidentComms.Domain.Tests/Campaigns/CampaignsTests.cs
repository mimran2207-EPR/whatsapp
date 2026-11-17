using ResidentComms.Domain.Campaigns;
namespace ResidentComms.Domain.Tests.Campaigns;

public class PreflightTests
{
    private static PreflightInput Ok() => new(3180, [], 0, false, 3000,
        new DateTimeOffset(2026, 11, 17, 10, 0, 0, TimeSpan.FromHours(2)), new TimeOnly(8, 0), new TimeOnly(20, 0), true);

    [Fact] public void Clean_input_has_only_cost_warning()
        => Assert.Equal(new[] { "AUDIENCE_SIZE_CHANGE", "COST_ESTIMATE_ONLY" }, Preflight.Evaluate(Ok()).Select(f => f.Code).Order());

    [Fact] public void No_eligible_recipients_blocks()
        => Assert.Contains(Preflight.Evaluate(Ok() with { EligibleRecipients = 0 }), f => f.Code == "NO_ELIGIBLE" && f.Severity == PreflightSeverity.Blocker);

    [Fact] public void Missing_field_blocks_and_names_the_count()
    {
        var f = Preflight.Evaluate(Ok() with { MissingFields = ["שם_ילד"], RecipientsWithMissingFields = 14 }).Single(x => x.Code == "MISSING_FIELD");
        Assert.Equal(PreflightSeverity.Blocker, f.Severity);
        Assert.Contains("14", f.MessageHe);
        Assert.Contains("שם_ילד", f.MessageHe);
    }

    [Fact] public void Duplicate_send_blocks()
        => Assert.Contains(Preflight.Evaluate(Ok() with { DuplicateInWindow = true }), f => f.Code == "DUPLICATE_SEND" && f.Severity == PreflightSeverity.Blocker);

    [Fact] public void Outside_window_is_a_warning_not_a_blocker()
        => Assert.Contains(Preflight.Evaluate(Ok() with { ScheduledAtLocal = new DateTimeOffset(2026, 11, 17, 21, 30, 0, TimeSpan.FromHours(2)) }),
            f => f.Code == "OUTSIDE_SEND_WINDOW" && f.Severity == PreflightSeverity.Warning);

    [Fact] public void Small_audience_change_is_not_flagged()
        => Assert.DoesNotContain(Preflight.Evaluate(Ok() with { PreviousAudienceSize = 3150 }), f => f.Code == "AUDIENCE_SIZE_CHANGE");
}

public class ApprovalPackageTests
{
    private static ApprovalPackageContent C() => new(Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001"), Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002"),
        "SMS", "שלום {שם_הורה}", new Dictionary<string, string> { ["b"] = "2", ["a"] = "1" }, null, 1);

    [Fact] public void Hash_is_stable_and_order_independent()
    {
        var reordered = C() with { FieldDefaults = new Dictionary<string, string> { ["a"] = "1", ["b"] = "2" } };
        Assert.Equal(ApprovalPackage.Hash(C()), ApprovalPackage.Hash(reordered));
        Assert.Matches("^[0-9a-f]{64}$", ApprovalPackage.Hash(C()));
    }

    [Fact] public void Any_material_change_changes_the_hash()
    {
        var h = ApprovalPackage.Hash(C());
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { ContentText = "שלום" }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { AudienceVersionId = Guid.NewGuid() }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { ScheduledAt = DateTimeOffset.UnixEpoch }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { PolicyVersion = 2 }));
    }
}

public class ApprovalPolicyTests
{
    [Fact] public void Creator_cannot_self_approve_above_threshold()
        => Assert.Equal(ApprovalDecision.SelfApprovalAboveThreshold, ApprovalPolicy.Check("u1", true, "u1", 3180, 1000, "h", "h"));
    [Fact] public void Creator_may_self_approve_at_or_below_threshold()
        => Assert.Equal(ApprovalDecision.Allowed, ApprovalPolicy.Check("u1", true, "u1", 1000, 1000, "h", "h"));
    [Fact] public void Approver_role_is_required()
        => Assert.Equal(ApprovalDecision.NotApproverRole, ApprovalPolicy.Check("u2", false, "u1", 10, 1000, "h", "h"));
    [Fact] public void Changed_package_is_stale()
        => Assert.Equal(ApprovalDecision.StaleRevision, ApprovalPolicy.Check("u2", true, "u1", 10, 1000, "h1", "h2"));
}

public class MessageKeyTests
{
    [Fact] public void Key_excludes_revision_and_is_deterministic()
    {
        var t = Guid.Parse("11111111-1111-1111-1111-111111111111"); var c = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var k = MessageKey.For(t, c, "ID:000123", "SMS", 1);
        Assert.Equal(k, MessageKey.For(t, c, "ID:000123", "sms", 1));
        Assert.Matches("^[0-9a-f]{64}$", k);
        Assert.NotEqual(k, MessageKey.For(t, c, "ID:000123", "SMS", 2));
    }
}
