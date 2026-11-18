using System.Net;
using ResidentComms.TestShared;

namespace ResidentComms.Api.Tests;

/// <summary>
/// Final review I1: the "above the threshold, not self" rule must hold against everyone who shaped the content (creator,
/// editors of the current revision, submitter), not only Campaign.created_by.
/// The threshold is lowered to 1 (as in the creator test) so the small fixture file stands for the "5,000 recipients" case.
/// </summary>
public class SelfApprovalBypassTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה", variableColumns = new[] { "שם ילד", "גן" },
    };
    private static readonly Dictionary<string, string> ChildDefault = new() { ["שם ילד"] = "ילדכם" };
    private static string Text(string tag) => $"שלום {{שם הורה}}, עבור {{שם ילד}} ({tag})";

    private HttpClient Noa() => f.ClientWith("noa", "approver", ApiFactory.DevTenant, "EDU");

    private async Task<(Guid Camp, ImportResult Imp)> DanaDraft(HttpClient dana, string tag)
    {
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var camp = await dana.CreateCampaign("bypass-" + tag);
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = Text(tag), fieldDefaults = ChildDefault });
        return (camp, imp);
    }

    private async Task WithThreshold(int max, Func<Task> body)
    {
        await f.Db.ExecAsync($"UPDATE TenantPolicy SET self_approval_max_recipients = {max} WHERE tenant_id = '{ApiFactory.DevTenant}'");
        try { await body(); }
        finally { await f.Db.ExecAsync($"UPDATE TenantPolicy SET self_approval_max_recipients = 1000 WHERE tenant_id = '{ApiFactory.DevTenant}'"); }
    }

    private static async Task AssertSelfApproval(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal("SELF_APPROVAL_ABOVE_THRESHOLD", await r.CodeOf());
    }

    [Fact] public async Task Approver_who_edited_submitted_and_approves_someone_elses_campaign_is_rejected_and_a_third_approver_may_approve()
        => await WithThreshold(1, async () =>
        {
            var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
            var (camp, _) = await DanaDraft(dana, "edit-then-approve");
            await meir.PatchDraft(camp, new { contentText = Text("edited by meir") });
            var hash = await meir.Submit(camp);
            await AssertSelfApproval(await meir.ApproveRaw(camp, hash));
            Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Approval a JOIN CampaignRevision r ON r.campaign_revision_id = a.campaign_revision_id WHERE r.campaign_id = '{camp}'"));

            var approvals = await meir.GetFromJsonAsyncList("/v1/approvals");
            Assert.DoesNotContain(approvals, a => a == camp);
            Assert.Contains(await Noa().GetFromJsonAsyncList("/v1/approvals"), a => a == camp);
            await Noa().Approve(camp, hash);
        });

    [Fact] public async Task Approver_who_only_submitted_someone_elses_draft_cannot_approve_it()
        => await WithThreshold(1, async () =>
        {
            var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
            var (camp, _) = await DanaDraft(dana, "submitter");
            var hash = await meir.Submit(camp);
            await AssertSelfApproval(await meir.ApproveRaw(camp, hash));
            await Noa().Approve(camp, hash);
        });

    [Fact] public async Task Approver_who_reopened_and_someone_else_resubmitted_still_cannot_approve()
        => await WithThreshold(1, async () =>
        {
            var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
            var (camp, _) = await DanaDraft(dana, "reopen");
            await dana.Submit(camp);
            var r = await meir.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{camp}/reopen", new { }, Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var hash = await dana.Submit(camp); // dana resubmits the revision meir opened
            await AssertSelfApproval(await meir.ApproveRaw(camp, hash));
            await Noa().Approve(camp, hash);
        });

    [Fact] public async Task Within_the_threshold_the_same_approver_may_edit_submit_and_approve()
        => await WithThreshold(1000, async () =>
        {
            var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
            var (camp, _) = await DanaDraft(dana, "small");
            await meir.PatchDraft(camp, new { contentText = Text("small edited") });
            await meir.Approve(camp, await meir.Submit(camp));
        });

    // Round 2: editors of an earlier revision must follow the content into every later revision.
    [Theory]
    [InlineData("reopen")]
    [InlineData("typo")]
    public async Task Editor_of_an_earlier_revision_stays_a_contributor_after_reopen_or_patch_by_someone_else(string how)
        => await WithThreshold(1, async () =>
        {
            var dana = await f.LoginAs("dana"); var noa = Noa(); var meir = await f.LoginAs("meir");
            var (camp, _) = await DanaDraft(dana, "carry-" + how);
            await noa.PatchDraft(camp, new { contentText = Text("rewritten by noa " + how) }); // rev1 EDIT noa
            await dana.Submit(camp);
            if (how == "reopen")
                Assert.Equal(HttpStatusCode.OK, (await dana.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{camp}/reopen", new { }, Guid.NewGuid().ToString())).StatusCode);
            else
                await dana.PatchDraft(camp, new { contentText = Text("rewritten by noa " + how) + " ." }); // dana fixes a typo on a SUBMITTED campaign -> rev2
            var hash = await dana.Submit(camp);

            await AssertSelfApproval(await noa.ApproveRaw(camp, hash));
            Assert.DoesNotContain(await noa.GetFromJsonAsyncList("/v1/approvals"), a => a == camp);
            Assert.Contains(await meir.GetFromJsonAsyncList("/v1/approvals"), a => a == camp);   // a third approver still sees it
            await meir.Approve(camp, hash);
        });

    [Fact] public async Task Earlier_editor_may_still_approve_within_the_threshold()
        => await WithThreshold(1000, async () =>
        {
            var dana = await f.LoginAs("dana"); var noa = Noa();
            var (camp, _) = await DanaDraft(dana, "carry-small");
            await noa.PatchDraft(camp, new { contentText = Text("noa small") });
            await dana.Submit(camp);
            await dana.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{camp}/reopen", new { }, Guid.NewGuid().ToString());
            await noa.Approve(camp, await dana.Submit(camp));
        });
}
