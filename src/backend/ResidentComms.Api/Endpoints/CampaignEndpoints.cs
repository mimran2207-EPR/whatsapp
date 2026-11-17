using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Repositories;

namespace ResidentComms.Api.Endpoints;

public static class CampaignEndpoints
{
    public sealed record CreateCampaignRequest(string? Name, string? Purpose);
    public sealed record PatchDraftRequest(Guid? AudienceVersionId, string? Channel, string? ContentText, Dictionary<string, string>? FieldDefaults, DateTimeOffset? ScheduledAt);
    public sealed record SubmitRequest(string? Note);
    public sealed record ApproveRequest(string? PackageHash);

    private static readonly HashSet<string> Purposes = ["SERVICE", "OPERATIONAL", "PUBLIC_INFO", "EMERGENCY", "PROMOTIONAL"];

    // Every mutating handler does its work in one repository transaction and returns only after the commit,
    // so a throw can only happen before anything is committed (the idempotency filter releases the key only on a throw).
    public static void MapCampaigns(this RouteGroupBuilder v1)
    {
        v1.MapGet("/campaigns", async (ICurrentUser user, CampaignRepository repo) =>
        {
            var asOf = repo.DataAsOf;
            var rows = await repo.ListAsync(user.TenantId);
            return Results.Ok(rows.Select(r => new
            {
                r.CampaignId, r.Name, r.Purpose, r.State, r.Channel, r.Recipients,
                Counts = new { r.Accepted, r.Delivered, r.Unknown, r.Failed },
                DataAsOf = asOf,
            }));
        });

        v1.MapGet("/approvals", async (ICurrentUser user, CampaignRepository repo) =>
            ApiResults.CanApprove(user) ? Results.Ok(await repo.ListApprovalsAsync(user.TenantId, user.UserId, user.DepartmentId)) : Results.Ok(Array.Empty<object>()));

        v1.MapPost("/campaigns", async (CreateCampaignRequest req, ICurrentUser user, CampaignRepository repo) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 200 || req.Purpose is null || !Purposes.Contains(req.Purpose))
                return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
            var (campaignId, revisionId) = await repo.CreateAsync(user.TenantId, user.DepartmentId, user.UserId, req.Name, req.Purpose);
            return Results.Json(new { campaignId, revisionId }, statusCode: StatusCodes.Status201Created);
        });

        v1.MapPatch("/campaigns/{id:guid}/draft", async (Guid id, PatchDraftRequest req, ICurrentUser user, CampaignRepository repo) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            var r = await repo.PatchDraftAsync(user.TenantId, id,
                new DraftPatch(req.AudienceVersionId, req.Channel, req.ContentText, req.FieldDefaults, req.ScheduledAt));
            return ApiResults.From(r, o => Results.Ok(new { revisionId = o.RevisionId, approvalInvalidated = o.ApprovalInvalidated }));
        });

        v1.MapPost("/campaigns/{id:guid}/preflight", async (Guid id, ICurrentUser user, CampaignRepository repo) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            var r = await repo.PreflightAsync(user.TenantId, id);
            return ApiResults.From(r, p => Results.Ok(new
            {
                findings = p.Findings,
                eligibleRecipients = p.EligibleRecipients,
                segmentsPerMessage = p.SegmentsPerMessage,
                encoding = p.Encoding,
                estimatedCost = new { min = p.CostMin, max = p.CostMax, currency = "ILS", isEstimate = true },
            }));
        });

        // The optional note is accepted but not persisted: no table holds a submit note in the M1 schema.
        v1.MapPost("/campaigns/{id:guid}/submit", async (Guid id, SubmitRequest? req, ICurrentUser user, CampaignRepository repo) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            var r = await repo.SubmitAsync(user.TenantId, id);
            return ApiResults.From(r, hash => Results.Ok(new { packageHash = hash }));
        });

        v1.MapPost("/campaigns/{id:guid}/approve", async (Guid id, ApproveRequest req, ICurrentUser user, CampaignRepository repo) =>
        {
            if (!ApiResults.CanApprove(user)) return ApiResults.Error("NOT_APPROVER", StatusCodes.Status403Forbidden);
            if (string.IsNullOrWhiteSpace(req.PackageHash)) return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
            var r = await repo.ApproveAsync(user.TenantId, id, user.UserId, user.DepartmentId, req.PackageHash);
            return ApiResults.From(r, approvalId => Results.Ok(new { approvalId }));
        });

        v1.MapPost("/campaigns/{id:guid}/release", async (Guid id, ICurrentUser user, ReleaseService release) =>
        {
            if (!ApiResults.CanApprove(user)) return ApiResults.ForbiddenRole();
            var r = await release.ReleaseAsync(user.TenantId, id, user.DepartmentId);
            return ApiResults.From(r, o => Results.Json(
                new { messagesCreated = o.MessagesCreated, suppressed = o.Suppressed, environment = "sandbox-mock" },
                statusCode: StatusCodes.Status202Accepted));
        });
    }
}
