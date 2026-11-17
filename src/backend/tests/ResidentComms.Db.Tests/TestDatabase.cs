using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace ResidentComms.Db.Tests;

/// <summary>Creates ResidentComms_Test_&lt;guid&gt;, applies db/migrations in order, drops it afterwards.</summary>
public sealed class TestDatabase : IAsyncLifetime
{
    private static readonly string ServerCs =
        Environment.GetEnvironmentVariable("RESIDENTCOMMS_SQL")
        ?? "Server=localhost;Integrated Security=true;TrustServerCertificate=true";

    public string Name { get; } = $"ResidentComms_Test_{Guid.NewGuid():N}";
    private string DbCs => new SqlConnectionStringBuilder(ServerCs) { InitialCatalog = Name }.ConnectionString;

    public async Task InitializeAsync()
    {
        await using (var master = new SqlConnection(ServerCs))
        {
            await master.OpenAsync();
            await new SqlCommand($"CREATE DATABASE [{Name}]", master).ExecuteNonQueryAsync();
        }
        var dir = FindMigrationsDir();
        foreach (var file in Directory.GetFiles(dir, "V*.sql").Order())
            foreach (var batch in Regex.Split(await File.ReadAllTextAsync(file), @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
                if (!string.IsNullOrWhiteSpace(batch)) await Exec(batch);
    }

    public async Task DisposeAsync()
    {
        SqlConnection.ClearAllPools();
        await using var master = new SqlConnection(ServerCs);
        await master.OpenAsync();
        await new SqlCommand($"ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}]", master).ExecuteNonQueryAsync();
    }

    public SqlConnection Open()
    {
        var c = new SqlConnection(DbCs);
        c.Open();
        return c;
    }

    public async Task<int> Exec(string sql)
    {
        await using var c = Open();
        return await new SqlCommand(sql, c).ExecuteNonQueryAsync();
    }

    private static string FindMigrationsDir()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !Directory.Exists(Path.Combine(d.FullName, "db", "migrations"))) d = d.Parent;
        return d is null ? throw new DirectoryNotFoundException("db/migrations not found") : Path.Combine(d.FullName, "db", "migrations");
    }
}
