using System.Net.Http.Json;
using System.Text.Json;

namespace ResidentComms.Api.Tests;

public sealed record ImportResult(Guid ImportRunId, Guid AudienceId, Guid AudienceVersionId, int RowCount, int ValidCount, int InvalidCount);
public sealed record PatchResult(Guid RevisionId, bool ApprovalInvalidated);
public sealed record ReleaseResult(int MessagesCreated, int Suppressed, string Environment);

/// <summary>Test helpers for the campaign flow; every call uses a fresh Idempotency-Key (one user action = one key).</summary>
public static class CampaignFlowHelpers
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<T> ReadAs<T>(this HttpResponseMessage r)
    {
        var text = await r.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(text, Json) ?? throw new InvalidOperationException($"Empty body: {(int)r.StatusCode} {text}");
    }

    public static async Task<string> CodeOf(this HttpResponseMessage r)
        => (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

    public static async Task<HttpResponseMessage> UploadImportRaw(this HttpClient c, byte[] bytes, string fileName, object mapping, string? key = null)
    {
        var form = new MultipartFormDataContent
        {
            { new ByteArrayContent(bytes), "file", fileName },
            { new StringContent(JsonSerializer.Serialize(mapping, Json)), "mapping" },
        };
        var req = new HttpRequestMessage(HttpMethod.Post, "/v1/import-jobs") { Content = form };
        req.Headers.Add("Idempotency-Key", key ?? Guid.NewGuid().ToString());
        return await c.SendAsync(req);
    }

    public static async Task<ImportResult> UploadImport(this HttpClient c, byte[] bytes, string fileName, object mapping)
    {
        var r = await c.UploadImportRaw(bytes, fileName, mapping);
        Assert.Equal(System.Net.HttpStatusCode.Created, r.StatusCode);
        return await r.ReadAs<ImportResult>();
    }

    public static async Task<Guid> CreateCampaign(this HttpClient c, string name, string purpose = "SERVICE")
    {
        var r = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name, purpose }, Guid.NewGuid().ToString());
        Assert.Equal(System.Net.HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("campaignId").GetGuid();
    }

    public static Task<HttpResponseMessage> PatchDraftRaw(this HttpClient c, Guid campaign, object body)
        => c.SendWithKey(HttpMethod.Patch, $"/v1/campaigns/{campaign}/draft", body, Guid.NewGuid().ToString());

    public static async Task<PatchResult> PatchDraft(this HttpClient c, Guid campaign, object body)
    {
        var r = await c.PatchDraftRaw(campaign, body);
        Assert.Equal(System.Net.HttpStatusCode.OK, r.StatusCode);
        return await r.ReadAs<PatchResult>();
    }

    public static Task<HttpResponseMessage> PreflightRaw(this HttpClient c, Guid campaign)
        => c.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{campaign}/preflight", new { }, Guid.NewGuid().ToString());

    public static Task<HttpResponseMessage> SubmitRaw(this HttpClient c, Guid campaign)
        => c.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{campaign}/submit", new { }, Guid.NewGuid().ToString());

    public static async Task<string> Submit(this HttpClient c, Guid campaign)
    {
        var r = await c.SubmitRaw(campaign);
        Assert.Equal(System.Net.HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("packageHash").GetString()!;
    }

    public static Task<HttpResponseMessage> ApproveRaw(this HttpClient c, Guid campaign, string packageHash)
        => c.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{campaign}/approve", new { packageHash }, Guid.NewGuid().ToString());

    public static async Task Approve(this HttpClient c, Guid campaign, string packageHash)
        => Assert.Equal(System.Net.HttpStatusCode.OK, (await c.ApproveRaw(campaign, packageHash)).StatusCode);

    public static Task<HttpResponseMessage> ReleaseRaw(this HttpClient c, Guid campaign)
        => c.SendWithKey(HttpMethod.Post, $"/v1/campaigns/{campaign}/release", new { }, Guid.NewGuid().ToString());

    public static async Task<ReleaseResult> Release(this HttpClient c, Guid campaign)
    {
        var r = await c.ReleaseRaw(campaign);
        Assert.Equal(System.Net.HttpStatusCode.Accepted, r.StatusCode);
        return await r.ReadAs<ReleaseResult>();
    }
}

public static class ApprovalListHelpers
{
    public static async Task<List<Guid>> GetFromJsonAsyncList(this HttpClient c, string url)
    {
        var j = await c.GetFromJsonAsync<JsonElement>(url);
        return j.EnumerateArray().Select(e => e.GetProperty("campaignId").GetGuid()).ToList();
    }
}
