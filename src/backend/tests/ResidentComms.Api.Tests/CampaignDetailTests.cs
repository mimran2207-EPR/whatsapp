using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ResidentComms.TestShared;

namespace ResidentComms.Api.Tests;

/// <summary>Task 9 fix round: campaign detail (draft resume + approver preview), explicit schedule clearing, release queue.</summary>
public class CampaignDetailTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה",
        variableColumns = new[] { "שם ילד", "גן" },
    };

    private async Task<(Guid Camp, ImportResult Imp)> Draft(HttpClient dana, string tag)
    {
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var camp = await dana.CreateCampaign("detail-" + tag);
        await dana.PatchDraft(camp, new
        {
            audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = $"שלום {{שם הורה}}, עבור {{שם ילד}}. [{tag}]",
            fieldDefaults = new Dictionary<string, string> { ["שם ילד"] = "ילדכם" },
        });
        return (camp, imp);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact] public async Task Detail_returns_the_draft_and_a_masked_server_rendered_preview()
    {
        var dana = await f.LoginAs("dana");
        var (camp, imp) = await Draft(dana, "a");
        var r = await dana.GetAsync($"/v1/campaigns/{camp}");
        var raw = await r.Content.ReadAsStringAsync();
        var d = await Json(r);

        Assert.Equal("DRAFT", d.GetProperty("state").GetString());
        Assert.Equal("detail-a", d.GetProperty("name").GetString());
        Assert.Equal("SMS", d.GetProperty("channel").GetString());
        Assert.Equal("שלום {שם הורה}, עבור {שם ילד}. [a]", d.GetProperty("contentText").GetString());
        Assert.Equal("ילדכם", d.GetProperty("fieldDefaults").GetProperty("שם ילד").GetString());
        Assert.Equal(JsonValueKind.Null, d.GetProperty("scheduledAt").ValueKind);

        var a = d.GetProperty("audience");
        Assert.Equal(imp.AudienceVersionId, a.GetProperty("audienceVersionId").GetGuid());
        Assert.Equal(imp.ImportRunId, a.GetProperty("importRunId").GetGuid());
        Assert.Equal(imp.ValidCount, a.GetProperty("validCount").GetInt32());
        Assert.Equal(imp.RowCount, a.GetProperty("rowCount").GetInt32());
        Assert.Equal("הורי גנים.xlsx", a.GetProperty("fileName").GetString());
        var fields = a.GetProperty("fieldNames").EnumerateArray().Select(x => x.GetString()).ToList();
        Assert.Contains("שם ילד", fields);
        Assert.Contains("שם הורה", fields);

        // First VALID recipient (row "דנה כהן", 052-1234567, child "נועה"), rendered by the server; identity masked.
        var p = d.GetProperty("preview");
        Assert.Equal("שלום דנה כ., עבור נועה. [a]", p.GetProperty("text").GetString());
        Assert.Equal("דנה כ.", p.GetProperty("recipientName").GetString());
        Assert.Equal("052-***-**67", p.GetProperty("recipientPhone").GetString());
        Assert.DoesNotContain("0521234567", raw);
        Assert.DoesNotContain("052-1234567", raw);
        Assert.DoesNotContain("דנה כהן", raw);
        Assert.DoesNotContain(Fixtures.ValidRowId, raw);
    }

    [Fact] public async Task Detail_of_another_tenants_campaign_is_404()
    {
        var dana = await f.LoginAs("dana");
        var (camp, _) = await Draft(dana, "b");
        var other = f.ClientWith("eve", "creator", Guid.NewGuid(), "EDU");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/v1/campaigns/{camp}")).StatusCode);
    }

    [Fact] public async Task Detail_requires_a_known_role()
    {
        var dana = await f.LoginAs("dana");
        var (camp, _) = await Draft(dana, "c");
        var guest = f.ClientWith("gus", "guest", ApiFactory.DevTenant, "EDU");
        Assert.Equal(HttpStatusCode.Forbidden, (await guest.GetAsync($"/v1/campaigns/{camp}")).StatusCode);
    }

    [Fact] public async Task Patch_with_explicit_null_clears_the_schedule_and_absent_keeps_it()
    {
        var dana = await f.LoginAs("dana");
        var (camp, _) = await Draft(dana, "d");
        var at = DateTimeOffset.Parse("2026-11-18T09:30:00Z");

        await dana.PatchDraft(camp, new { scheduledAt = at });
        Assert.Equal(at, (await Json(await dana.GetAsync($"/v1/campaigns/{camp}"))).GetProperty("scheduledAt").GetDateTimeOffset());

        await dana.PatchDraft(camp, new { contentText = "טקסט אחר {שם ילד}" }); // scheduledAt absent: unchanged
        Assert.Equal(at, (await Json(await dana.GetAsync($"/v1/campaigns/{camp}"))).GetProperty("scheduledAt").GetDateTimeOffset());

        await dana.PatchDraft(camp, new { scheduledAt = (DateTimeOffset?)null }); // explicit null: cleared
        Assert.Equal(JsonValueKind.Null, (await Json(await dana.GetAsync($"/v1/campaigns/{camp}"))).GetProperty("scheduledAt").ValueKind);
    }

    [Fact] public async Task Approved_but_unreleased_campaign_is_in_the_release_queue_until_released()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, imp) = await Draft(dana, "e");
        await meir.Approve(camp, await dana.Submit(camp));

        var queue = (await Json(await meir.GetAsync("/v1/approvals/approved"))).EnumerateArray().ToList();
        var item = Assert.Single(queue, x => x.GetProperty("campaignId").GetGuid() == camp);
        Assert.Equal("detail-e", item.GetProperty("name").GetString());
        Assert.Equal("meir", item.GetProperty("approvedBy").GetString());
        Assert.True(item.GetProperty("recipients").GetInt32() > 0);
        Assert.Empty((await Json(await dana.GetAsync("/v1/approvals/approved"))).EnumerateArray()); // creators get nothing

        await meir.Release(camp);
        Assert.DoesNotContain((await Json(await meir.GetAsync("/v1/approvals/approved"))).EnumerateArray(),
            x => x.GetProperty("campaignId").GetGuid() == camp);
    }

    [Fact] public async Task Release_queue_is_tenant_scoped()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await Draft(dana, "f");
        await meir.Approve(camp, await dana.Submit(camp));
        var other = f.ClientWith("otto", "approver", Guid.NewGuid(), "EDU");
        Assert.DoesNotContain((await Json(await other.GetAsync("/v1/approvals/approved"))).EnumerateArray(),
            x => x.GetProperty("campaignId").GetGuid() == camp);
    }
}
