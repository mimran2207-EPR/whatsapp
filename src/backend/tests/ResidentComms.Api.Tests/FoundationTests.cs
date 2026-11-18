using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

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

    [Fact] public async Task Tenant_comes_from_token_only_never_from_body_header_query_or_route()
    {
        var tenantB = Guid.NewGuid();
        await f.Db.ExecAsync($"INSERT Tenant(tenant_id, name) VALUES ('{tenantB}', N'tenant B'); INSERT TenantPolicy(tenant_id) VALUES ('{tenantB}');");
        var a = await f.LoginAs("dana");                                                        // tenant A = dev tenant
        var b = f.ClientWith("bella", "creator", tenantB, "EDU");                               // tenant B

        async Task<Guid> Create(HttpClient c, string name, Guid spoof)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, $"/v1/campaigns?tenantId={spoof}")
            { Content = JsonContent.Create(new { name, purpose = "SERVICE", tenantId = spoof, tenant_id = spoof }) };
            req.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            req.Headers.Add("X-Tenant-Id", spoof.ToString());
            req.Headers.Add("Tenant-Id", spoof.ToString());
            var r = await c.SendAsync(req);
            Assert.Equal(HttpStatusCode.Created, r.StatusCode);
            return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("campaignId").GetGuid();
        }

        var idA = await Create(a, "tenant-A-campaign", spoof: tenantB);                         // A claims to be B everywhere
        var idB = await Create(b, "tenant-B-campaign", spoof: ApiFactory.DevTenant);            // B claims to be A everywhere
        Assert.Equal(ApiFactory.DevTenant, await f.Db.ScalarAsync<Guid>($"SELECT tenant_id FROM Campaign WHERE campaign_id = '{idA}'"));
        Assert.Equal(tenantB, await f.Db.ScalarAsync<Guid>($"SELECT tenant_id FROM Campaign WHERE campaign_id = '{idB}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT revision_no FROM CampaignRevision WHERE campaign_id = '{idA}'"));

        // each tenant sees only its own rows, whatever it claims
        async Task<List<Guid>> ListIds(HttpClient c, Guid spoof)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, $"/v1/campaigns?tenantId={spoof}");
            req.Headers.Add("X-Tenant-Id", spoof.ToString());
            return (await (await c.SendAsync(req)).Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().Select(e => e.GetProperty("campaignId").GetGuid()).ToList();
        }
        var seenByA = await ListIds(a, tenantB); var seenByB = await ListIds(b, ApiFactory.DevTenant);
        Assert.Contains(idA, seenByA); Assert.DoesNotContain(idB, seenByA);
        Assert.Contains(idB, seenByB); Assert.DoesNotContain(idA, seenByB);

        // reading the other tenant's campaign by id is 404 even with a spoofed header
        var spoofed = new HttpRequestMessage(HttpMethod.Get, $"/v1/campaigns/{idA}");
        spoofed.Headers.Add("X-Tenant-Id", ApiFactory.DevTenant.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await b.SendAsync(spoofed)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/v1/campaigns/{idA}/tracking")).StatusCode);
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

public class HardeningTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private sealed class StoreFailingAfterCommit(ResidentComms.Infrastructure.Sql.SqlConnectionFactory db)
        : ResidentComms.Infrastructure.Sql.IdempotencyStore(db)
    {
        public override Task SetResultAsync(Guid tenantId, string operationType, string key, int status, string body)
            => throw new InvalidOperationException("simulated store failure");
    }

    [Fact] public async Task Store_failure_after_commit_does_not_allow_reexecution()
    {
        using var broken = f.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ResidentComms.Infrastructure.Sql.IdempotencyStore>();
            s.AddSingleton<ResidentComms.Infrastructure.Sql.IdempotencyStore, StoreFailingAfterCommit>();
        }));
        var login = await broken.CreateClient().PostAsJsonAsync("/v1/dev/login", new { userId = "dana" });
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var c = broken.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var key = Guid.NewGuid().ToString();
        var body = new { name = "nodup-" + key, purpose = "SERVICE" };
        var first = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", body, key);
        var retry = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", body, key);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, retry.StatusCode);
        Assert.Contains("IDEMPOTENCY_IN_PROGRESS", await retry.Content.ReadAsStringAsync());
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Campaign WHERE campaign_name = N'nodup-{key}'"));
    }

    [Fact] public async Task Token_without_tenant_claim_is_401()
    {
        var key = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(ApiFactory.TestSigningKey));
        var token = new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler().CreateToken(new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
        {
            Issuer = "residentcomms-dev",
            Audience = "residentcomms-api",
            Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new Microsoft.IdentityModel.Tokens.SigningCredentials(key, Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim("sub", "dana"),
                new System.Security.Claims.Claim("role", "creator"),
                new System.Security.Claims.Claim("department_id", "EDU"),
            ]),
        });
        var c = f.CreateClient();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/v1/campaigns")).StatusCode);
    }
}
