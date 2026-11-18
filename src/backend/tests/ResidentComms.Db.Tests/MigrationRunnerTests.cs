using Microsoft.Data.SqlClient;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Db.Tests;

public class MigrationRunnerTests
{
    private static readonly string ServerCs =
        Environment.GetEnvironmentVariable("RESIDENTCOMMS_SQL")
        ?? "Server=localhost;Integrated Security=true;TrustServerCertificate=true";

    [Fact]
    public async Task Migrations_apply_in_order_once_and_V006_creates_the_revision_actor_table()
    {
        var name = $"ResidentComms_Test_{Guid.NewGuid():N}";
        var server = new SqlConnectionStringBuilder(ServerCs).DataSource;
        var runner = new MigrationRunner(server, name, MigrationRunner.FindRepoDir(Path.Combine("db", "migrations")));
        try
        {
            var first = await runner.MigrateAsync();
            Assert.Equal(first.Order(StringComparer.Ordinal).ToList(), first);          // applied in version order
            Assert.Equal("V006", first[^1]);
            Assert.Empty(await runner.MigrateAsync());                                  // idempotent: nothing applied twice

            await using var c = new SqlConnection(new SqlConnectionStringBuilder(ServerCs) { InitialCatalog = name }.ConnectionString);
            await c.OpenAsync();
            Assert.Equal(1, (int)(await new SqlCommand("SELECT COUNT(*) FROM sys.tables WHERE name = 'CampaignRevisionActor'", c).ExecuteScalarAsync())!);
            Assert.Equal(first.Count, (int)(await new SqlCommand("SELECT COUNT(*) FROM SchemaVersion", c).ExecuteScalarAsync())!);
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await using var master = new SqlConnection(ServerCs);
            await master.OpenAsync();
            await new SqlCommand($"IF DB_ID('{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END", master).ExecuteNonQueryAsync();
        }
    }
}
