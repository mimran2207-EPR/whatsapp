using System.Security.Claims;

namespace ResidentComms.Api.Auth;

/// <summary>The authenticated principal. Read from token claims only; never from route, query or body.</summary>
public interface ICurrentUser
{
    string UserId { get; }
    string Role { get; }
    Guid TenantId { get; }
    string DepartmentId { get; }
}

public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal Principal => accessor.HttpContext?.User ?? throw new InvalidOperationException("No HTTP context.");

    private string Claim(string type) =>
        Principal.FindFirst(type)?.Value ?? throw new InvalidOperationException($"Missing claim '{type}'.");

    public string UserId => Claim("sub");
    public string Role => Claim("role");
    public Guid TenantId => Guid.Parse(Claim("tenant_id"));
    public string DepartmentId => Claim("department_id");
}
