using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;

namespace ResidentComms.Api.Tests;

public class FoundationTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact] public async Task Health_reports_sandbox()
        => Assert.Contains("sandbox-mock", await f.CreateClient().GetStringAsync("/health"));

    [Fact] public async Task Unauthenticated_v1_call_is_401()
        => Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/v1/campaigns")).StatusCode);

    [Fact] public async Task Post_without_idempotency_key_is_400()
    {
        var c = await f.LoginAs("dana");
        var r = await c.PostAsJsonAsync("/v1/campaigns", new { name = "x", purpose = "SERVICE" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("IDEMPOTENCY_KEY_REQUIRED", await r.Content.ReadAsStringAsync());
    }

    [Fact] public async Task Same_key_same_body_replays_and_different_body_conflicts()
    {
        var c = await f.LoginAs("dana"); var key = Guid.NewGuid().ToString();
        var a = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "א", purpose = "SERVICE" }, key);
        var b = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "א", purpose = "SERVICE" }, key);
        var d = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "ב", purpose = "SERVICE" }, key);
        Assert.Equal(HttpStatusCode.Created, a.StatusCode);
        Assert.Equal(HttpStatusCode.Created, b.StatusCode);
        Assert.Equal(await a.Content.ReadAsStringAsync(), await b.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, d.StatusCode);
        Assert.Contains("IDEMPOTENCY_CONFLICT", await d.Content.ReadAsStringAsync());
    }

    [Fact] public async Task Replay_does_not_create_a_second_campaign()
    {
        var c = await f.LoginAs("dana"); var key = Guid.NewGuid().ToString();
        var body = new { name = "replay-" + key, purpose = "SERVICE" };
        await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", body, key);
        await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", body, key);
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Campaign WHERE campaign_name = N'replay-{key}'"));
    }

    [Fact] public async Task Tenant_comes_from_token_not_body()
    {
        var c = await f.LoginAs("dana");
        var r = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "x", purpose = "SERVICE", tenantId = Guid.NewGuid() }, Guid.NewGuid().ToString());
        var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("campaignId").GetGuid();
        Assert.Equal(ApiFactory.DevTenant, await f.Db.ScalarAsync<Guid>($"SELECT tenant_id FROM Campaign WHERE campaign_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT revision_no FROM CampaignRevision WHERE campaign_id = '{id}'"));
    }

    [Fact] public async Task Dev_users_lists_three_synthetic_users()
    {
        var users = await f.CreateClient().GetFromJsonAsync<JsonElement>("/v1/dev/users");
        Assert.Equal(3, users.GetArrayLength());
        Assert.Equal("creator", users[0].GetProperty("role").GetString());
    }

    [Fact] public async Task Login_with_unknown_user_is_404()
    {
        var r = await f.CreateClient().PostAsJsonAsync("/v1/dev/login", new { userId = "nobody" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact] public async Task Dev_endpoints_are_404_outside_Development()
    {
        using var prod = f.WithWebHostBuilder(b => b.UseEnvironment("Production"));
        var r = await prod.CreateClient().PostAsJsonAsync("/v1/dev/login", new { userId = "dana" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await prod.CreateClient().GetAsync("/v1/dev/users")).StatusCode);
    }

    [Fact] public async Task Get_does_not_require_idempotency_key()
    {
        var c = await f.LoginAs("meir");
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/v1/campaigns")).StatusCode);
    }
}
