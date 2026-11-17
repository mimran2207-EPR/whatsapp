using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace ResidentComms.DbMigrator;

/// <summary>Creates the database if missing and applies db/migrations/V*.sql not yet recorded in SchemaVersion.</summary>
public sealed class MigrationRunner(string server, string database, string migrationsDir)
{
    private static readonly Regex AllowedName = new(@"^(whatsapp|ResidentComms_[A-Za-z0-9_]{1,100})$", RegexOptions.CultureInvariant);

    public static bool IsAllowedDatabase(string name) => AllowedName.IsMatch(name);

    private static readonly Regex GoLine = new(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);

    private string ConnectionString(string? catalog) => new SqlConnectionStringBuilder
    {
        DataSource = server,
        IntegratedSecurity = true,
        TrustServerCertificate = true,
        InitialCatalog = catalog ?? "master",
    }.ConnectionString;

    /// <summary>Returns the versions applied by this run (empty = up to date).</summary>
    public async Task<IReadOnlyList<string>> MigrateAsync()
    {
        if (!IsAllowedDatabase(database))
            throw new InvalidOperationException($"Refusing to touch database '{database}': only 'whatsapp' or 'ResidentComms_*' are allowed.");

        await using (var master = new SqlConnection(ConnectionString(null)))
        {
            await master.OpenAsync();
            var cmd = new SqlCommand(
                "IF DB_ID(@db) IS NULL BEGIN DECLARE @sql nvarchar(max) = N'CREATE DATABASE ' + QUOTENAME(@db); EXEC sp_executesql @sql; END", master);
            cmd.Parameters.AddWithValue("@db", database);
            await cmd.ExecuteNonQueryAsync();
        }

        await using var conn = new SqlConnection(ConnectionString(database));
        await conn.OpenAsync();
        await new SqlCommand(
            "IF OBJECT_ID('dbo.SchemaVersion') IS NULL CREATE TABLE SchemaVersion(version VARCHAR(50) NOT NULL PRIMARY KEY, applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME())",
            conn).ExecuteNonQueryAsync();

        var done = new HashSet<string>();
        await using (var r = await new SqlCommand("SELECT version FROM SchemaVersion", conn).ExecuteReaderAsync())
            while (await r.ReadAsync()) done.Add(r.GetString(0));

        var applied = new List<string>();
        foreach (var file in Directory.GetFiles(migrationsDir, "V*.sql").Order(StringComparer.Ordinal))
        {
            var version = Path.GetFileName(file).Split("__")[0];
            if (done.Contains(version)) continue;
            await ApplyScriptAsync(conn, await File.ReadAllTextAsync(file), version);
            applied.Add(version);
        }
        return applied;
    }

    /// <summary>Applies the dev seed script (idempotent). Allowed only on 'whatsapp'.</summary>
    public async Task SeedDevAsync(string seedFile)
    {
        if (database != "whatsapp")
            throw new InvalidOperationException("--seed-dev is allowed only on database 'whatsapp'.");
        await using var conn = new SqlConnection(ConnectionString(database));
        await conn.OpenAsync();
        await ApplyScriptAsync(conn, await File.ReadAllTextAsync(seedFile), null);
    }

    private static async Task ApplyScriptAsync(SqlConnection conn, string script, string? version)
    {
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync();
        try
        {
            foreach (var batch in GoLine.Split(script))
                if (!string.IsNullOrWhiteSpace(batch))
                    await new SqlCommand(batch, conn, tx).ExecuteNonQueryAsync();
            if (version is not null)
            {
                var ins = new SqlCommand("INSERT SchemaVersion(version) VALUES (@v)", conn, tx);
                ins.Parameters.AddWithValue("@v", version);
                await ins.ExecuteNonQueryAsync();
            }
            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public static string FindRepoDir(string relative)
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !Directory.Exists(Path.Combine(d.FullName, relative))) d = d.Parent;
        return d is null ? throw new DirectoryNotFoundException($"{relative} not found") : Path.Combine(d.FullName, relative);
    }
}
