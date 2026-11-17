using ResidentComms.Api.Auth;

namespace ResidentComms.Api.Endpoints;

public static class DevEndpoints
{
    public sealed record LoginRequest(string? UserId);

    /// <summary>Mock login. Mapped only in Development; elsewhere these routes do not exist (404).</summary>
    public static void MapDev(this WebApplication app)
    {
        var dev = app.MapGroup("/v1/dev").AllowAnonymous();

        dev.MapGet("/users", () => DevAuth.Users.Select(u => new
        {
            id = u.Id, name = u.Name, role = u.Role,
            tenantId = DevAuth.DevTenantId, departmentId = DevAuth.DevDepartment,
        }));

        dev.MapPost("/login", (LoginRequest req, DevAuth auth) =>
        {
            var user = DevAuth.Users.FirstOrDefault(u => u.Id == req.UserId);
            return user is null
                ? Results.NotFound(new { code = "UNKNOWN_DEV_USER" })
                : Results.Ok(new { token = auth.CreateToken(user) });
        });
    }
}
