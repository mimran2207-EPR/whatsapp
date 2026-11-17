using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Api.Tests;

/// <summary>Creates ResidentComms_Test_&lt;guid&gt;, migrates it, seeds the dev tenant, drops it on dispose.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly Guid DevTenant = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // Test-only key (not a secret): satisfies the >= 32 byte requirement.
    public const string TestSigningKey = "test-only-signing-key-0123456789-abcdefghijklmnop";

    private static readonly string ServerCs =
        Environment.GetEnvironmentVariable("RESIDENTCOMMS_SQL")
        ?? "Server=localhost;Integrated Security=true;TrustServerCertificate=true";

    public string DatabaseName { get; } = $"ResidentComms_Test_{Guid.NewGuid():N}";
    public TestDb Db { get; private set; } = null!;

    /// <summary>Fixed clock: 2026-11-17 10:00 Asia/Jerusalem (08:00Z), inside the default 08:00-20:00 send window. Tests may move it.</summary>
    public FixedTimeProvider Clock { get; } = new(DateTimeOffset.Parse("2026-11-17T08:00:00Z"));

    private string DbCs => new SqlConnectionStringBuilder(ServerCs) { InitialCatalog = DatabaseName }.ConnectionString;

    public async Task InitializeAsync()
    {
        var server = new SqlConnectionStringBuilder(ServerCs).DataSource;
        var runner = new MigrationRunner(server, DatabaseName, MigrationRunner.FindRepoDir(Path.Combine("db", "migrations")));
        await runner.MigrateAsync();
        Db = new TestDb(DbCs);
        var seed = Path.Combine(MigrationRunner.FindRepoDir("db"), "seed", "dev-seed.sql");
        await Db.ExecAsync(await File.ReadAllTextAsync(seed));
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        SqlConnection.ClearAllPools();
        await using var master = new SqlConnection(ServerCs);
        await master.OpenAsync();
        await new SqlCommand($"ALTER DATABASE [{DatabaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{DatabaseName}]", master).ExecuteNonQueryAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Default", DbCs);
        builder.UseSetting("Auth:DevSigningKey", TestSigningKey);
        builder.ConfigureTestServices(s => s.AddSingleton<TimeProvider>(Clock));
    }

    public async Task<HttpClient> LoginAs(string userId)
    {
        var c = CreateClient();
        var r = await c.PostAsJsonAsync("/v1/dev/login", new { userId });
        r.EnsureSuccessStatusCode();
        var token = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }
}

public sealed class TestDb(string connectionString)
{
    public async Task ExecAsync(string sql)
    {
        foreach (var batch in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch)) continue;
            await using var c = new SqlConnection(connectionString);
            await c.OpenAsync();
            await new SqlCommand(batch, c).ExecuteNonQueryAsync();
        }
    }

    public async Task<T> ScalarAsync<T>(string sql)
    {
        await using var c = new SqlConnection(connectionString);
        await c.OpenAsync();
        return (T)(await new SqlCommand(sql, c).ExecuteScalarAsync())!;
    }
}

public static class HttpClientExtensions
{
    public static Task<HttpResponseMessage> SendWithKey(this HttpClient c, HttpMethod method, string url, object body, string? key)
    {
        var req = new HttpRequestMessage(method, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (key is not null) req.Headers.Add("Idempotency-Key", key);
        return c.SendAsync(req);
    }
}

public sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}
