using Dapper;
using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Api.Endpoints;

public static class CampaignEndpoints
{
    public sealed record CreateCampaignRequest(string? Name, string? Purpose);

    private static readonly HashSet<string> Purposes = ["SERVICE", "OPERATIONAL", "PUBLIC_INFO", "EMERGENCY", "PROMOTIONAL"];

    /// <summary>Minimal version (Task 5); Task 6 extends it.</summary>
    public static void MapCampaigns(this RouteGroupBuilder v1)
    {
        v1.MapGet("/campaigns", async (ICurrentUser user, SqlConnectionFactory db) =>
        {
            await using var c = await db.OpenAsync();
            var rows = await c.QueryAsync(
                @"SELECT campaign_id AS campaignId, campaign_name AS name, communication_purpose AS purpose, campaign_state AS state
                  FROM Campaign WHERE tenant_id = @tenant ORDER BY created_at DESC",
                new { tenant = user.TenantId });
            return Results.Ok(rows);
        });

        v1.MapPost("/campaigns", async (CreateCampaignRequest req, ICurrentUser user, SqlConnectionFactory db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 200 || req.Purpose is null || !Purposes.Contains(req.Purpose))
                return Results.Json(new { code = "VALIDATION_FAILED" }, statusCode: StatusCodes.Status400BadRequest);

            var campaignId = Guid.NewGuid();
            await using var c = await db.OpenAsync();
            await using var tx = await c.BeginTransactionAsync();
            await c.ExecuteAsync(
                @"INSERT Campaign(campaign_id, tenant_id, department_id, campaign_name, campaign_type, communication_purpose, campaign_state, created_by)
                  VALUES (@campaignId, @tenant, @department, @name, 'MANUAL', @purpose, 'DRAFT', @createdBy)",
                new { campaignId, tenant = user.TenantId, department = user.DepartmentId, name = req.Name, purpose = req.Purpose, createdBy = user.UserId }, tx);
            await c.ExecuteAsync(
                "INSERT CampaignRevision(campaign_revision_id, tenant_id, campaign_id, revision_no) VALUES (@id, @tenant, @campaignId, 1)",
                new { id = Guid.NewGuid(), tenant = user.TenantId, campaignId }, tx);
            await tx.CommitAsync();
            return Results.Json(new { campaignId }, statusCode: StatusCodes.Status201Created);
        });
    }
}
