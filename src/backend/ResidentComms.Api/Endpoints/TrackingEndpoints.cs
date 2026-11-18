using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Repositories;

namespace ResidentComms.Api.Endpoints;

public static class TrackingEndpoints
{
    public static void MapTracking(this RouteGroupBuilder v1)
    {
        v1.MapGet("/campaigns/{id:guid}/tracking", async (Guid id, ICurrentUser user, TrackingQueries tracking, CancellationToken ct) =>
        {
            if (user.Role is not ("creator" or "approver" or "analyst")) return ApiResults.ForbiddenRole();
            var view = await tracking.GetAsync(user.TenantId, id, ct); // tenant from the token only
            return view is null ? ApiResults.Error("NOT_FOUND", StatusCodes.Status404NotFound) : Results.Ok(view);
        });
    }
}
