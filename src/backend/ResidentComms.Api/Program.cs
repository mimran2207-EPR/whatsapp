using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;
using ResidentComms.Api.Auth;
using ResidentComms.Api.Endpoints;
using ResidentComms.Api.Idempotency;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ResidentComms.Infrastructure.Repositories;
using ResidentComms.Infrastructure.Sql;

var builder = WebApplication.CreateBuilder(args);

// Configuration is read lazily (inside factories) so that host-level overrides, e.g. from tests, are honoured.
builder.Services.AddSingleton<DevAuth>();
builder.Services.AddSingleton(sp => new SqlConnectionFactory(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));
builder.Services.AddSingleton<IdempotencyStore>();
builder.Services.TryAddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ImportLimits>();
builder.Services.AddSingleton<AudienceRepository>();
builder.Services.AddSingleton<CampaignRepository>();
builder.Services.AddSingleton<ReleaseService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<DevAuth>((o, dev) =>
    {
        o.MapInboundClaims = false;
        o.Events = new JwtBearerEvents
        {
            // A token without the full principal is rejected as 401 here instead of failing with 500 later.
            OnTokenValidated = ctx =>
            {
                var u = ctx.Principal;
                static bool Has(System.Security.Claims.ClaimsPrincipal? p, string t) => !string.IsNullOrWhiteSpace(p?.FindFirst(t)?.Value);
                if (!Has(u, "sub") || !Has(u, "role") || !Has(u, "department_id")
                    || !Guid.TryParse(u!.FindFirst("tenant_id")?.Value, out var tenant) || tenant == Guid.Empty)
                    ctx.Fail("Token is missing required claims.");
                return Task.CompletedTask;
            },
        };
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = DevAuth.Issuer,
            ValidAudience = DevAuth.Audience,
            IssuerSigningKey = dev.Key,
            NameClaimType = "name",
            RoleClaimType = "role",
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();

// Fail fast: resolving these validates the signing key and the (guarded) connection string at startup.
app.Services.GetRequiredService<DevAuth>();
app.Services.GetRequiredService<SqlConnectionFactory>();

// The idempotency filter hashes the raw body after model binding, so the body must be re-readable.
app.Use(async (ctx, next) =>
{
    if (IdempotencyFilter.AppliesTo(ctx.Request)) ctx.Request.EnableBuffering();
    await next();
});

// Outside Development the dev routes do not exist: answer 404 before the fallback policy can answer 401.
if (!app.Environment.IsDevelopment())
    app.Use(async (ctx, next) =>
    {
        if (ctx.Request.Path.StartsWithSegments("/v1/dev")) ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        else await next();
    });

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", environment = "sandbox-mock" })).AllowAnonymous();

if (app.Environment.IsDevelopment()) app.MapDev();

var v1 = app.MapGroup("/v1").AddEndpointFilter<IdempotencyFilter>();
v1.MapImports();
v1.MapCampaigns();

app.Run();

public partial class Program;
