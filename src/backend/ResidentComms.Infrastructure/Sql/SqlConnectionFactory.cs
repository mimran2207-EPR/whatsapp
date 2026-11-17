using Microsoft.Data.SqlClient;

namespace ResidentComms.Infrastructure.Sql;

/// <summary>Opens connections to the configured database; refuses anything but 'whatsapp' or 'ResidentComms_*'.</summary>
public sealed class SqlConnectionFactory
{
    private readonly string _connectionString;

    public SqlConnectionFactory(string connectionString)
    {
        var db = new SqlConnectionStringBuilder(connectionString).InitialCatalog;
        if (!MigrationRunner.IsAllowedDatabase(db))
            throw new InvalidOperationException($"Refusing to connect to database '{db}': only 'whatsapp' or 'ResidentComms_*' are allowed.");
        _connectionString = connectionString;
    }

    public async Task<SqlConnection> OpenAsync(CancellationToken ct = default)
    {
        var c = new SqlConnection(_connectionString);
        try { await c.OpenAsync(ct); return c; }
        catch { await c.DisposeAsync(); throw; }
    }
}
