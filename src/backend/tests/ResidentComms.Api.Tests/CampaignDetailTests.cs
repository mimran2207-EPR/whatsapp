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

    // ---- fix round 2: masking by the same normalised source the renderer uses ----
    [Fact] public async Task Preview_masks_a_name_that_is_over_200_chars_untrimmed_and_also_mapped_as_a_variable()
    {
        var dana = await f.LoginAs("dana");
        var longName = "אבי " + new string('ל', 250) + " כהן";            // stored truncated to 200 in recipient_name, whole in the variable
        var csv = "ת.ז,שם הורה,טל נייד הורה,שם ילד\n" + $"300000001,\"  {longName}  \",0521234567,נועה\n";
        var mapping = new { idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה", variableColumns = new[] { "שם הורה", "שם ילד" } };
        var imp = await dana.UploadImport(System.Text.Encoding.UTF8.GetBytes(csv), "ארוך.csv", mapping);
        var camp = await dana.CreateCampaign("detail-long");
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = "שלום {שם הורה}, עבור {שם ילד}." });

        var r = await dana.GetAsync($"/v1/campaigns/{camp}");
        var raw = await r.Content.ReadAsStringAsync();
        var p = (await Json(r)).GetProperty("preview");
        Assert.Equal("שלום אבי ל., עבור נועה.", p.GetProperty("text").GetString());
        Assert.Equal("אבי ל.", p.GetProperty("recipientName").GetString());
        Assert.DoesNotContain("לללל", raw);
        Assert.DoesNotContain("כהן", raw);
    }

    [Fact] public async Task Preview_never_shows_a_long_single_word_name_whole()
    {
        var dana = await f.LoginAs("dana");
        var word = new string('מ', 300);
        var csv = "ת.ז,שם הורה,טל נייד הורה\n" + $"300000002,{word},0521234568\n";
        var imp = await dana.UploadImport(System.Text.Encoding.UTF8.GetBytes(csv), "מילה.csv",
            new { idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה", variableColumns = new[] { "שם הורה" } });
        var camp = await dana.CreateCampaign("detail-word");
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = "שלום {שם הורה}" });
        var raw = await (await dana.GetAsync($"/v1/campaigns/{camp}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain(new string('מ', 60), raw);
    }

    // ---- fix round 2: reopen (withdraw the submission) ----
    private static Task<HttpResponseMessage> Reopen(HttpClient c, Guid camp)
        => c.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{camp}/reopen", new { }, Guid.NewGuid().ToString());

    [Fact] public async Task Reopen_returns_a_submitted_campaign_to_draft_and_it_can_be_submitted_again_unchanged()
    {
        var dana = await f.LoginAs("dana");
        var (camp, _) = await Draft(dana, "g");
        var first = await dana.Submit(camp);
        var o = await Json(await Reopen(dana, camp));
        Assert.False(o.GetProperty("approvalInvalidated").GetBoolean()); // nobody had approved yet
        Assert.Equal("DRAFT", (await Json(await dana.GetAsync($"/v1/campaigns/{camp}"))).GetProperty("state").GetString());
        Assert.NotEqual(first, await dana.Submit(camp)); // a new revision, so a new package hash
    }

    [Fact] public async Task Reopen_withdraws_an_approved_campaign_and_invalidates_the_approval()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await Draft(dana, "h");
        var hash = await dana.Submit(camp);
        await meir.Approve(camp, hash);
        var o = await Json(await Reopen(dana, camp));
        Assert.True(o.GetProperty("approvalInvalidated").GetBoolean());
        Assert.Equal("DRAFT", (await Json(await dana.GetAsync($"/v1/campaigns/{camp}"))).GetProperty("state").GetString());
        Assert.DoesNotContain((await Json(await meir.GetAsync("/v1/approvals/approved"))).EnumerateArray(), x => x.GetProperty("campaignId").GetGuid() == camp);
        Assert.NotEqual(HttpStatusCode.Accepted, (await meir.ReleaseRaw(camp)).StatusCode); // not releasable any more
        Assert.NotEqual(HttpStatusCode.OK, (await meir.ApproveRaw(camp, hash)).StatusCode);  // the old package cannot be approved
    }

    [Fact] public async Task Reopen_of_a_draft_is_a_no_op_and_of_a_released_campaign_is_refused()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (draft, _) = await Draft(dana, "i");
        Assert.Equal(HttpStatusCode.OK, (await Reopen(dana, draft)).StatusCode);

        var (rel, _) = await Draft(dana, "j");
        await meir.Approve(rel, await dana.Submit(rel));
        await meir.Release(rel);
        var r = await Reopen(dana, rel);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("ALREADY_RELEASED", await r.CodeOf());
    }

    [Fact] public async Task Reopen_is_role_and_tenant_checked()
    {
        var dana = await f.LoginAs("dana");
        var (camp, _) = await Draft(dana, "k");
        await dana.Submit(camp);
        var rina = await f.LoginAs("rina"); // analyst
        Assert.Equal(HttpStatusCode.Forbidden, (await Reopen(rina, camp)).StatusCode);
        var tenant2 = Guid.NewGuid();
        await f.Db.ExecAsync($"INSERT Tenant(tenant_id, name) VALUES ('{tenant2}', N'אחר'); INSERT TenantPolicy(tenant_id) VALUES ('{tenant2}');");
        var other = f.ClientWith("eve", "creator", tenant2, "EDU");
        Assert.Equal(HttpStatusCode.NotFound, (await Reopen(other, camp)).StatusCode);
    }
}
