using System.Data;
using Dapper;

namespace ResidentComms.Infrastructure.Sql;

public enum ClaimOutcome : byte { New = 0, Replay = 1, Conflict = 2 }

public sealed record StoredResponse(int? ResponseStatus, string? ResponseBody);

/// <summary>Thin wrapper over dbo.usp_ClaimIdempotencyKey / usp_SetIdempotencyResult / usp_ReleaseIdempotencyKey.</summary>
public class IdempotencyStore(SqlConnectionFactory db)
{
    private static DbString Ansi(string v) => new() { Value = v, IsAnsi = true };

    public async Task<ClaimOutcome> ClaimAsync(Guid tenantId, string operationType, string key, string requestHash)
    {
        await using var c = await db.OpenAsync();
        var p = new DynamicParameters();
        p.Add("@TenantId", tenantId);
        p.Add("@OperationType", operationType, DbType.AnsiString, size: 100);
        p.Add("@Key", key, DbType.AnsiString, size: 200);
        p.Add("@RequestHash", requestHash, DbType.AnsiStringFixedLength, size: 64);
        p.Add("@Outcome", dbType: DbType.Byte, direction: ParameterDirection.Output);
        await c.ExecuteAsync("dbo.usp_ClaimIdempotencyKey", p, commandType: CommandType.StoredProcedure);
        return (ClaimOutcome)p.Get<byte>("@Outcome");
    }

    public virtual async Task<StoredResponse?> GetResultAsync(Guid tenantId, string operationType, string key)
    {
        await using var c = await db.OpenAsync();
        return await c.QuerySingleOrDefaultAsync<StoredResponse>(
            @"SELECT response_status AS ResponseStatus, response_body AS ResponseBody
              FROM IdempotencyRecord WHERE tenant_id = @tenantId AND operation_type = @operationType AND idempotency_key = @key",
            new { tenantId, operationType = Ansi(operationType), key = Ansi(key) });
    }

    public virtual async Task SetResultAsync(Guid tenantId, string operationType, string key, int status, string body)
    {
        await using var c = await db.OpenAsync();
        await c.ExecuteAsync("dbo.usp_SetIdempotencyResult",
            new { TenantId = tenantId, OperationType = Ansi(operationType), Key = Ansi(key), ResponseStatus = status, ResponseBody = body },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReleaseAsync(Guid tenantId, string operationType, string key)
    {
        await using var c = await db.OpenAsync();
        await c.ExecuteAsync("dbo.usp_ReleaseIdempotencyKey",
            new { TenantId = tenantId, OperationType = Ansi(operationType), Key = Ansi(key) },
            commandType: CommandType.StoredProcedure);
    }
}
