using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ResidentComms.Api.Endpoints;
using ResidentComms.TestShared;

namespace ResidentComms.Api.Tests;

/// <summary>Fix round 1: safety rules re-checked at release, upload hardening, authorization scoping.</summary>
public class CampaignSafetyTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה",
        variableColumns = new[] { "שם ילד", "גן" },
    };
    private static readonly Dictionary<string, string> ChildDefault = new() { ["שם ילד"] = "ילדכם" };
    private static string Text(string tag) => $"שלום {{שם הורה}}, עבור {{שם ילד}}. [{tag}]";
    private ImportLimits Limits => f.Services.GetRequiredService<ImportLimits>();

    private async Task<(Guid Camp, ImportResult Imp)> DraftReady(HttpClient creator, string tag, object? extra = null, ImportResult? imp = null)
    {
        imp ??= await creator.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var camp = await creator.CreateCampaign(tag);
        await creator.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = Text(tag), fieldDefaults = ChildDefault });
        if (extra is not null) await creator.PatchDraft(camp, extra);
        return (camp, imp);
    }

    private async Task<int> MessageCount(Guid camp) => await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'");

    // ---- 1. duplicate send re-checked at release ----
    [Fact] public async Task Release_blocks_a_duplicate_of_an_already_released_campaign()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (a, imp) = await DraftReady(dana, "dup-release");
        var (b, _) = await DraftReady(dana, "dup-release", imp: imp); // same content text, same audience version
        await meir.Approve(a, await dana.Submit(a));
        await meir.Approve(b, await dana.Submit(b)); // neither released yet, so submit does not see a duplicate

        var first = await meir.Release(a);
        Assert.Equal(imp.ValidCount, first.MessagesCreated);
        var second = await meir.ReleaseRaw(b);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, second.StatusCode);
        Assert.Equal("DUPLICATE_SEND", await second.CodeOf());
        Assert.Equal(0, await MessageCount(b));
        Assert.Equal(imp.ValidCount, await MessageCount(a));
    }

    // ---- 2. zip bomb on actual bytes, signature check ----
    [Fact] public async Task Xlsx_whose_actual_uncompressed_size_exceeds_the_cap_is_rejected()
    {
        var dana = await f.LoginAs("dana");
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            var entry = zip.CreateEntry("xl/big.bin");
            await using var s = entry.Open();
            await s.WriteAsync(new byte[50_000]); // compresses to a few dozen bytes
        }
        Assert.True(ms.Length < 1024);
        var old = Limits.MaxUncompressedBytes;
        Limits.MaxUncompressedBytes = 1024;
        try
        {
            var r = await dana.UploadImportRaw(ms.ToArray(), "bomb.xlsx", Mapping);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
            Assert.Equal("FILE_TOO_LARGE_UNCOMPRESSED", await r.CodeOf());
        }
        finally { Limits.MaxUncompressedBytes = old; }
    }

    [Fact] public async Task Xlsx_extension_without_zip_signature_is_rejected()
    {
        var dana = await f.LoginAs("dana");
        var r = await dana.UploadImportRaw(Encoding.UTF8.GetBytes("a,b,c\n1,2,3\n"), "spoof.xlsx", Mapping);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
        Assert.Equal("UNSUPPORTED_FILE", await r.CodeOf());
    }

    // The idempotency filter reads the body before the endpoint does: an over-cap body must be a clean 413, not a 500.
    [Fact] public async Task Body_over_the_transport_ceiling_is_413_not_500_even_through_the_idempotency_filter()
    {
        var dana = await f.LoginAs("dana");
        var huge = new byte[10 * 1024 * 1024 + 256 * 1024]; // > 10 MB + 64 KB ceiling of /v1/import-jobs
        var r = await dana.UploadImportRaw(huge, "huge.csv", Mapping);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, r.StatusCode);
        Assert.Equal("FILE_TOO_LARGE", await r.CodeOf());

        // a JSON endpoint has a small default cap too
        var big = await dana.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = new string('x', 2 * 1024 * 1024), purpose = "SERVICE" }, Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, big.StatusCode);
    }

    // ---- 3. file size compared to the configured limit ----
    [Fact] public async Task File_larger_than_the_limit_is_rejected_with_413()
    {
        var dana = await f.LoginAs("dana");
        var old = Limits.MaxFileBytes;
        Limits.MaxFileBytes = 1024;
        try
        {
            var bytes = Fixtures.XlsxBytes();
            Assert.True(bytes.Length > 1024);
            var r = await dana.UploadImportRaw(bytes, "big.xlsx", Mapping);
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, r.StatusCode);
            Assert.Equal("FILE_TOO_LARGE", await r.CodeOf());
        }
        finally { Limits.MaxFileBytes = old; }
    }

    // ---- 4. masking ----
    [Fact] public async Task Import_sample_masks_ids_and_names()
    {
        var dana = await f.LoginAs("dana");
        var r = await dana.UploadImportRaw(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var text = await r.Content.ReadAsStringAsync();
        Assert.Contains("*****0001", text);
        Assert.Contains("דנה כ.", text);
        Assert.DoesNotContain(Fixtures.ValidRowId, text);
        Assert.DoesNotContain("דנה כהן", text);
    }

    // ---- 5/6. explicit state checks ----
    [Fact] public async Task Release_requires_state_approved()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "state-release");
        await meir.Approve(camp, await dana.Submit(camp));
        await f.Db.ExecAsync($"UPDATE Campaign SET campaign_state = 'SUBMITTED' WHERE campaign_id = '{camp}'");
        var r = await meir.ReleaseRaw(camp);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("INVALID_STATE", await r.CodeOf());
        Assert.Equal(0, await MessageCount(camp));
    }

    [Fact] public async Task Approve_checks_state_before_hash_and_wrong_hash_is_stale()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "state-approve");
        var bogus = new string('0', 64);
        var draft = await meir.ApproveRaw(camp, bogus); // still DRAFT
        Assert.Equal(HttpStatusCode.Conflict, draft.StatusCode);
        Assert.Equal("INVALID_STATE", await draft.CodeOf());

        var hash = await dana.Submit(camp);
        var wrong = await meir.ApproveRaw(camp, bogus);
        Assert.Equal(HttpStatusCode.Conflict, wrong.StatusCode);
        Assert.Equal("STALE_REVISION", await wrong.CodeOf());

        await meir.Approve(camp, hash);
        var again = await meir.ApproveRaw(camp, hash); // now APPROVED
        Assert.Equal("INVALID_STATE", await again.CodeOf());
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Approval a JOIN CampaignRevision r ON r.campaign_revision_id = a.campaign_revision_id WHERE r.campaign_id = '{camp}'"));
    }

    // ---- 7. time zone / DST ----
    [Theory]
    [InlineData("2026-11-17T18:30:00Z", false)] // 20:30 IST (UTC+2): outside 08:00-20:00
    [InlineData("2026-07-01T05:30:00Z", true)]  // 08:30 IDT (UTC+3): inside
    public async Task Send_window_follows_Jerusalem_time_across_DST(string utc, bool allowed)
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, imp) = await DraftReady(dana, "tz-" + utc);
        await meir.Approve(camp, await dana.Submit(camp));
        var original = f.Clock.Now;
        f.Clock.Now = DateTimeOffset.Parse(utc);
        try
        {
            var r = await meir.ReleaseRaw(camp);
            if (allowed) { Assert.Equal(HttpStatusCode.Accepted, r.StatusCode); Assert.Equal(imp.ValidCount, await MessageCount(camp)); }
            else { Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode); Assert.Equal("OUTSIDE_SEND_WINDOW", await r.CodeOf()); Assert.Equal(0, await MessageCount(camp)); }
        }
        finally { f.Clock.Now = original; }
    }

    // ---- 8. concurrency, tenant isolation, self-approval below threshold ----
    [Fact] public async Task Concurrent_releases_create_messages_once()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, imp) = await DraftReady(dana, "concurrent");
        await meir.Approve(camp, await dana.Submit(camp));
        var results = await Task.WhenAll(meir.ReleaseRaw(camp), meir.ReleaseRaw(camp));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.Accepted));
        var loser = results.Single(r => r.StatusCode != HttpStatusCode.Accepted);
        Assert.Equal(HttpStatusCode.Conflict, loser.StatusCode);
        Assert.Equal("ALREADY_RELEASED", await loser.CodeOf());
        Assert.Equal(imp.ValidCount, await MessageCount(camp));
    }

    [Fact] public async Task Another_tenant_cannot_see_or_touch_the_campaign_or_import()
    {
        var tenant2 = Guid.NewGuid();
        await f.Db.ExecAsync($"INSERT Tenant(tenant_id, name) VALUES ('{tenant2}', N'אחר'); INSERT TenantPolicy(tenant_id) VALUES ('{tenant2}');");
        var dana = await f.LoginAs("dana");
        var (camp, imp) = await DraftReady(dana, "tenant-iso");
        var hash = await dana.Submit(camp);

        var other = f.ClientWith("mallory", "approver", tenant2, "EDU");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/v1/import-jobs/{imp.ImportRunId}/errors")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PatchDraftRaw(camp, new { contentText = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PreflightRaw(camp)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.SubmitRaw(camp)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.ApproveRaw(camp, hash)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.ReleaseRaw(camp)).StatusCode);

        var list = await (await other.GetAsync("/v1/campaigns")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(list.EnumerateArray(), x => x.GetProperty("campaignId").GetGuid() == camp);
        Assert.Equal(0, (await (await other.GetAsync("/v1/approvals")).Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());

        // The other tenant cannot attach this tenant's audience to its own campaign either.
        var own = await other.CreateCampaign("own");
        var attach = await other.PatchDraftRaw(own, new { audienceVersionId = imp.AudienceVersionId });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, attach.StatusCode);
        Assert.Equal("AUDIENCE_NOT_FOUND", await attach.CodeOf());
        Assert.Equal("SUBMITTED", await f.Db.ScalarAsync<string>($"SELECT campaign_state FROM Campaign WHERE campaign_id = '{camp}'"));
    }

    [Fact] public async Task Approver_may_approve_own_campaign_at_or_below_the_threshold()
    {
        var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(meir, "self-ok"); // 3 recipients, default threshold 1000
        var hash = await meir.Submit(camp);
        var r = await meir.ApproveRaw(camp, hash);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("APPROVED", await f.Db.ScalarAsync<string>($"SELECT campaign_state FROM Campaign WHERE campaign_id = '{camp}'"));
    }

    // ---- 9. scheduling not supported in M1 ----
    [Fact] public async Task Release_of_a_future_scheduled_campaign_is_refused()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "scheduled", new { scheduledAt = f.Clock.Now.AddDays(1) });
        await meir.Approve(camp, await dana.Submit(camp));
        var r = await meir.ReleaseRaw(camp);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
        Assert.Equal("SCHEDULING_NOT_SUPPORTED_M1", await r.CodeOf());
        Assert.Equal(0, await MessageCount(camp));
    }

    // ---- 10. department scoping for approvers ----
    [Fact] public async Task Approver_from_another_department_is_forbidden()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var outsider = f.ClientWith("hana", "approver", ApiFactory.DevTenant, "HR");
        var (camp, _) = await DraftReady(dana, "dept");
        var hash = await dana.Submit(camp);

        var approvals = await (await outsider.GetAsync("/v1/approvals")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(approvals.EnumerateArray(), a => a.GetProperty("campaignId").GetGuid() == camp);
        var approve = await outsider.ApproveRaw(camp, hash);
        Assert.Equal(HttpStatusCode.Forbidden, approve.StatusCode);
        Assert.Equal("FORBIDDEN_DEPARTMENT", await approve.CodeOf());

        await meir.Approve(camp, hash);
        var release = await outsider.ReleaseRaw(camp);
        Assert.Equal(HttpStatusCode.Forbidden, release.StatusCode);
        Assert.Equal("FORBIDDEN_DEPARTMENT", await release.CodeOf());
        Assert.Equal(0, await MessageCount(camp));
    }
}
