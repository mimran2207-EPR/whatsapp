using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ResidentComms.Api.Auth;

public sealed record DevUser(string Id, string Name, string Role);

/// <summary>Signing key and synthetic users for the mock login. The key comes from configuration only (user-secrets / env).</summary>
public sealed class DevAuth
{
    public const string Issuer = "residentcomms-dev";
    public const string Audience = "residentcomms-api";
    public static readonly Guid DevTenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public const string DevDepartment = "EDU";

    public static readonly IReadOnlyList<DevUser> Users =
    [
        new("dana", "דנה לוי", "creator"),
        new("meir", "מאיר ברק", "approver"),
        new("rina", "רינה כהן", "analyst"),
    ];

    public SymmetricSecurityKey Key { get; }

    public DevAuth(IConfiguration config)
    {
        var secret = config["Auth:DevSigningKey"];
        if (string.IsNullOrWhiteSpace(secret) || Encoding.UTF8.GetByteCount(secret) < 32)
            throw new InvalidOperationException(
                "Auth:DevSigningKey is missing or shorter than 32 bytes. Set it with: dotnet user-secrets set \"Auth:DevSigningKey\" \"<32+ byte random string>\" (or the Auth__DevSigningKey env var).");
        Key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }

    public string CreateToken(DevUser u)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Expires = DateTime.UtcNow.AddHours(8),
            SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", u.Id),
                new Claim("name", u.Name),
                new Claim("role", u.Role),
                new Claim("tenant_id", DevTenantId.ToString()),
                new Claim("department_id", DevDepartment),
            ]),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}
