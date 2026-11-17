using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ResidentComms.TestShared;

namespace ResidentComms.Api.Tests;

public class CampaignFlowTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה",
        variableColumns = new[] { "שם ילד", "גן" },
    };

    private static readonly Dictionary<string, string> ChildDefault = new() { ["שם ילד"] = "ילדכם" };

    // Each test uses its own message text so the duplicate-send rule (same content + same audience) never fires across tests.
    private static string Text(string tag) => $"שלום {{שם הורה}}, תזכורת עבור {{שם ילד}}. ({tag})";

    private static Task<ImportResult> Import(HttpClient c) => c.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);

    private async Task<(Guid Camp, ImportResult Imp)> DraftReady(HttpClient creator, string name, string tag, Dictionary<string, string>? defaults)
    {
        var imp = await Import(creator);
        var camp = await creator.CreateCampaign(name);
        await creator.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = Text(tag), fieldDefaults = defaults ?? new Dictionary<string, string>() });
        return (camp, imp);
    }

    [Fact] public async Task Full_flow_creates_one_message_and_outbox_row_per_valid_recipient()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", new { idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה", variableColumns = new[] { "שם ילד", "גן" } });
        var camp = await dana.CreateCampaign("הזנה — נובמבר");
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = "שלום {שם הורה}, תזכורת עבור {שם ילד}.", fieldDefaults = new Dictionary<string,string> { ["שם ילד"] = "ילדכם" } });
        var hash = await dana.Submit(camp);
        await meir.Approve(camp, hash);
        var rel = await meir.Release(camp);
        Assert.Equal(imp.ValidCount, rel.MessagesCreated);
        Assert.Equal("sandbox-mock", rel.Environment);
        Assert.Equal(imp.ValidCount, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage o JOIN Message m ON m.message_id = o.aggregate_id WHERE m.campaign_id = '{camp}'"));
        Assert.Equal(imp.ValidCount, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageContent c JOIN Message m ON m.message_id = c.message_id WHERE m.campaign_id = '{camp}' AND c.rendered_text LIKE N'שלום %, תזכורת עבור %.'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageContent c JOIN Message m ON m.message_id = c.message_id WHERE m.campaign_id = '{camp}' AND c.rendered_text LIKE N'%ילדכם%'"));
        Assert.Equal("RELEASED", await f.Db.ScalarAsync<string>($"SELECT campaign_state FROM Campaign WHERE campaign_id = '{camp}'"));
        Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND (processing_state <> 'QUEUED' OR handoff_state <> 'NOT_HANDED_OFF' OR delivery_state <> 'NOT_REPORTED' OR data_quality <> 'CURRENT')"));
    }

    [Fact] public async Task Creator_cannot_approve_own_campaign_above_threshold()
    {
        // The brief's wording says "dana submits and approves"; dana is role=creator and so cannot approve at all (NOT_APPROVER).
        // The self-approval rule applies to an approver who created the campaign (an approver may also create): meir.
        var meir = await f.LoginAs("meir"); var dana = await f.LoginAs("dana");
        await f.Db.ExecAsync($"UPDATE TenantPolicy SET self_approval_max_recipients = 1 WHERE tenant_id = '{ApiFactory.DevTenant}'");
        try
        {
            var (camp, _) = await DraftReady(meir, "self-approval", "self", ChildDefault);
            var hash = await meir.Submit(camp);
            var r = await meir.ApproveRaw(camp, hash);
            Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
            Assert.Equal("SELF_APPROVAL_ABOVE_THRESHOLD", await r.CodeOf());

            var asCreator = await dana.ApproveRaw(camp, hash);
            Assert.Equal(HttpStatusCode.Forbidden, asCreator.StatusCode);
            Assert.Equal("NOT_APPROVER", await asCreator.CodeOf());
            Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Approval a JOIN CampaignRevision r ON r.campaign_revision_id = a.campaign_revision_id WHERE r.campaign_id = '{camp}'"));
        }
        finally { await f.Db.ExecAsync($"UPDATE TenantPolicy SET self_approval_max_recipients = 1000 WHERE tenant_id = '{ApiFactory.DevTenant}'"); }
    }

    [Fact] public async Task Draft_change_after_submit_invalidates_approval_and_blocks_release()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "draft-change", "change", ChildDefault);
        var hash = await dana.Submit(camp);
        await meir.Approve(camp, hash);

        var patch = await dana.PatchDraft(camp, new { contentText = Text("change") + " שונה" });
        Assert.True(patch.ApprovalInvalidated);
        Assert.Equal(2, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM CampaignRevision WHERE campaign_id = '{camp}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Approval a JOIN CampaignRevision r ON r.campaign_revision_id = a.campaign_revision_id WHERE r.campaign_id = '{camp}' AND a.invalidated_at IS NOT NULL"));

        var rel = await meir.ReleaseRaw(camp);
        Assert.Equal(HttpStatusCode.Conflict, rel.StatusCode);
        Assert.Equal("APPROVAL_INVALID", await rel.CodeOf());
        Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'"));

        // The old package hash can no longer be approved (the campaign is back in DRAFT, so the state check answers first).
        var stale = await meir.ApproveRaw(camp, hash);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("INVALID_STATE", await stale.CodeOf());
    }

    [Fact] public async Task Missing_field_without_default_blocks_submit()
    {
        var dana = await f.LoginAs("dana");
        // Content uses {שם ילד} without a default; the fixture has a valid row with an empty child name.
        var (camp, _) = await DraftReady(dana, "missing-field", "missing", null);
        var r = await dana.SubmitRaw(camp);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("PREFLIGHT_BLOCKED", body.GetProperty("code").GetString());
        Assert.Contains(body.GetProperty("findings").EnumerateArray(), x => x.GetProperty("code").GetString() == "MISSING_FIELD");
        Assert.Equal("DRAFT", await f.Db.ScalarAsync<string>($"SELECT campaign_state FROM Campaign WHERE campaign_id = '{camp}'"));
    }

    [Fact] public async Task Suppressed_destination_is_not_sent()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, imp) = await DraftReady(dana, "suppressed", "suppressed", ChildDefault);
        var hash = await dana.Submit(camp);
        await meir.Approve(camp, hash);

        var phone = await f.Db.ScalarAsync<string>($"SELECT TOP 1 phone_normalized FROM AudienceMember WHERE audience_version_id = '{imp.AudienceVersionId}' AND validation_state = 'VALID' ORDER BY source_row_number");
        await f.Db.ExecAsync($"INSERT SuppressionEntry(tenant_id, channel, destination_normalized, reason) VALUES ('{ApiFactory.DevTenant}', 'SMS', N'{phone}', 'OPT_OUT')");
        try
        {
            var rel = await meir.Release(camp);
            Assert.Equal(imp.ValidCount - 1, rel.MessagesCreated);
            Assert.Equal(1, rel.Suppressed);
            Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND destination_value = N'{phone}'"));
        }
        finally { await f.Db.ExecAsync($"DELETE SuppressionEntry WHERE tenant_id = '{ApiFactory.DevTenant}' AND destination_normalized = N'{phone}'"); }
    }

    [Fact] public async Task Releasing_twice_does_not_duplicate_messages()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, imp) = await DraftReady(dana, "twice", "twice", ChildDefault);
        await meir.Approve(camp, await dana.Submit(camp));
        await meir.Release(camp);
        var before = await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'");
        Assert.Equal(imp.ValidCount, before);

        var second = await meir.ReleaseRaw(camp); // new Idempotency-Key
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("ALREADY_RELEASED", await second.CodeOf());
        Assert.Equal(before, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'"));
        Assert.Equal(before, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage o JOIN Message m ON m.message_id = o.aggregate_id WHERE m.campaign_id = '{camp}'"));
    }

    [Fact] public async Task Release_outside_send_window_is_rejected_with_no_bypass()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "window", "window", ChildDefault);
        await meir.Approve(camp, await dana.Submit(camp));
        var original = f.Clock.Now;
        f.Clock.Now = DateTimeOffset.Parse("2026-11-17T21:00:00Z"); // 23:00 Asia/Jerusalem
        try
        {
            var r = await meir.ReleaseRaw(camp);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
            Assert.Equal("OUTSIDE_SEND_WINDOW", await r.CodeOf());
            Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'"));
            Assert.Equal("APPROVED", await f.Db.ScalarAsync<string>($"SELECT campaign_state FROM Campaign WHERE campaign_id = '{camp}'"));
        }
        finally { f.Clock.Now = original; }
    }

    [Fact] public async Task Roles_are_enforced_server_side()
    {
        var dana = await f.LoginAs("dana"); var rina = await f.LoginAs("rina");
        var asAnalyst = await rina.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "x", purpose = "SERVICE" }, Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Forbidden, asAnalyst.StatusCode);
        Assert.Equal("FORBIDDEN_ROLE", await asAnalyst.CodeOf());
        Assert.Equal(HttpStatusCode.OK, (await rina.GetAsync("/v1/campaigns")).StatusCode);

        var camp = await dana.CreateCampaign("roles");
        var release = await dana.ReleaseRaw(camp);
        Assert.Equal(HttpStatusCode.Forbidden, release.StatusCode);
        Assert.Equal("FORBIDDEN_ROLE", await release.CodeOf());
        var upload = await rina.UploadImportRaw(Fixtures.XlsxBytes(), "a.xlsx", Mapping);
        Assert.Equal(HttpStatusCode.Forbidden, upload.StatusCode);
    }

    [Fact] public async Task Import_reports_counts_masks_phones_and_lists_row_errors()
    {
        var dana = await f.LoginAs("dana");
        var r = await dana.UploadImportRaw(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var text = await r.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(text).RootElement;
        Assert.Equal(7, body.GetProperty("rowCount").GetInt32());
        Assert.Equal(3, body.GetProperty("validCount").GetInt32());
        Assert.Equal(4, body.GetProperty("invalidCount").GetInt32());
        Assert.True(body.GetProperty("codes").GetProperty("DUPLICATE_ID").GetInt32() >= 1);
        var sample = body.GetProperty("sample");
        Assert.Equal(5, sample.GetArrayLength());
        Assert.Equal("052-***-**67", sample[0].GetProperty("phone").GetString());
        Assert.DoesNotContain("1234567", text);

        var id = body.GetProperty("importRunId").GetGuid();
        var errs = await (await dana.GetAsync($"/v1/import-jobs/{id}/errors")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, errs.GetArrayLength());
        Assert.Contains(errs.EnumerateArray(), e => e.GetProperty("sourceRecipientId").GetString() == "*****0002"
            && e.GetProperty("codes").EnumerateArray().Any(c => c.GetString() == "FORMULA_VALUE"));
    }

    [Fact] public async Task Import_error_rows_need_an_authoring_role()
    {
        var dana = await f.LoginAs("dana");
        var id = (await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping)).ImportRunId;
        Assert.Equal(HttpStatusCode.OK, (await dana.GetAsync($"/v1/import-jobs/{id}/errors")).StatusCode);
        var analyst = await f.LoginAs("rina");
        var denied = await analyst.GetAsync($"/v1/import-jobs/{id}/errors");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("FORBIDDEN_ROLE", await denied.CodeOf());
        Assert.Equal(HttpStatusCode.Forbidden, (await f.ClientWith("x", "visitor", ApiFactory.DevTenant, "EDU").GetAsync($"/v1/import-jobs/{id}/errors")).StatusCode);
    }

    [Fact] public async Task Import_enforces_row_and_column_limits()
    {
        var dana = await f.LoginAs("dana");
        var rows = new StringBuilder("id,name,phone\n");
        for (var i = 0; i < 20_001; i++) rows.Append($"{100000000 + i},n,0521234567\n");
        var many = await dana.UploadImportRaw(Encoding.UTF8.GetBytes(rows.ToString()), "big.csv", new { idColumn = "id", nameColumn = "name", phoneColumn = "phone", variableColumns = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, many.StatusCode);
        Assert.Equal("TOO_MANY_ROWS", await many.CodeOf());

        var cols = string.Join(",", Enumerable.Range(0, 51).Select(i => $"c{i}"));
        var wide = await dana.UploadImportRaw(Encoding.UTF8.GetBytes(cols + "\n" + string.Join(",", Enumerable.Range(0, 51)) + "\n"), "wide.csv", new { idColumn = "c0", nameColumn = "c1", phoneColumn = "c2", variableColumns = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, wide.StatusCode);
        Assert.Equal("TOO_MANY_COLUMNS", await wide.CodeOf());

        var bad = await dana.UploadImportRaw(Fixtures.XlsxBytes(), "a.xlsx", new { idColumn = "nope", phoneColumn = "טל נייד הורה", variableColumns = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bad.StatusCode);
        Assert.Equal("MAPPING_COLUMN_NOT_FOUND", await bad.CodeOf());
    }

    [Fact] public async Task Preflight_reports_eligible_recipients_segments_and_estimated_cost()
    {
        var dana = await f.LoginAs("dana");
        var (camp, imp) = await DraftReady(dana, "preflight", "preflight", ChildDefault);
        var r = await dana.PreflightRaw(camp);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(imp.ValidCount, body.GetProperty("eligibleRecipients").GetInt32());
        Assert.True(body.GetProperty("segmentsPerMessage").GetInt32() >= 1);
        Assert.Equal("UCS2", body.GetProperty("encoding").GetString());
        Assert.True(body.GetProperty("estimatedCost").GetProperty("isEstimate").GetBoolean());
        Assert.Equal("ILS", body.GetProperty("estimatedCost").GetProperty("currency").GetString());
        Assert.Contains(body.GetProperty("findings").EnumerateArray(), x => x.GetProperty("code").GetString() == "COST_ESTIMATE_ONLY");
    }

    [Fact] public async Task Identical_content_to_same_audience_within_window_is_blocked_as_duplicate_send()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var imp = await Import(dana);
        async Task<Guid> Draft()
        {
            var c = await dana.CreateCampaign("dup");
            await dana.PatchDraft(c, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = Text("dup"), fieldDefaults = ChildDefault });
            return c;
        }
        var first = await Draft();
        await meir.Approve(first, await dana.Submit(first));
        await meir.Release(first);

        var second = await Draft();
        var r = await dana.SubmitRaw(second);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(body.GetProperty("findings").EnumerateArray(), x => x.GetProperty("code").GetString() == "DUPLICATE_SEND");
    }

    [Fact] public async Task Lists_show_campaigns_and_approvals_for_the_current_tenant_user()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var (camp, _) = await DraftReady(dana, "listed", "listed", ChildDefault);
        await dana.Submit(camp);

        var approvals = await (await meir.GetAsync("/v1/approvals")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(approvals.EnumerateArray(), a => a.GetProperty("campaignId").GetGuid() == camp);
        var danaApprovals = await (await dana.GetAsync("/v1/approvals")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, danaApprovals.GetArrayLength());

        var list = await (await dana.GetAsync("/v1/campaigns")).Content.ReadFromJsonAsync<JsonElement>();
        var row = list.EnumerateArray().First(x => x.GetProperty("campaignId").GetGuid() == camp);
        Assert.Equal("SUBMITTED", row.GetProperty("state").GetString());
        Assert.Equal("SMS", row.GetProperty("channel").GetString());
        Assert.Equal(0, row.GetProperty("counts").GetProperty("delivered").GetInt32());
    }
}
