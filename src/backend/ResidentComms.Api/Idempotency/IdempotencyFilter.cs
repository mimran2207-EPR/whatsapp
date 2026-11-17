using System.Security.Cryptography;
using System.Text;
using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Api.Idempotency;

/// <summary>
/// Endpoint filter for POST/PUT/PATCH under /v1 (except /v1/dev/* and /v1/provider-events/*).
/// Requires an Idempotency-Key header, claims it through dbo.usp_ClaimIdempotencyKey, and replays the stored response.
/// </summary>
public sealed class IdempotencyFilter(IdempotencyStore store, ICurrentUser user, ILogger<IdempotencyFilter> logger) : IEndpointFilter
{
    public const string HeaderName = "Idempotency-Key";

    public static bool AppliesTo(HttpRequest req) =>
        (HttpMethods.IsPost(req.Method) || HttpMethods.IsPut(req.Method) || HttpMethods.IsPatch(req.Method))
        && req.Path.StartsWithSegments("/v1")
        && !req.Path.StartsWithSegments("/v1/dev")
        && !req.Path.StartsWithSegments("/v1/provider-events");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var req = http.Request;
        if (!AppliesTo(req)) return await next(ctx);

        var key = req.Headers[HeaderName].ToString();
        if (string.IsNullOrWhiteSpace(key))
            return Results.Json(new { code = "IDEMPOTENCY_KEY_REQUIRED" }, statusCode: StatusCodes.Status400BadRequest);
        if (key.Length > 200)
            return Results.Json(new { code = "IDEMPOTENCY_KEY_INVALID" }, statusCode: StatusCodes.Status400BadRequest);

        var pattern = (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? req.Path.Value ?? "";
        var operation = $"{req.Method} {pattern}";
        var tenant = user.TenantId;
        var hash = await HashAsync(req);

        switch (await store.ClaimAsync(tenant, operation, key, hash))
        {
            case ClaimOutcome.Conflict:
                return Results.Json(new { code = "IDEMPOTENCY_CONFLICT" }, statusCode: StatusCodes.Status409Conflict);

            case ClaimOutcome.Replay:
                var stored = await store.GetResultAsync(tenant, operation, key);
                if (stored?.ResponseStatus is null)
                    return Results.Json(new { code = "IDEMPOTENCY_IN_PROGRESS" }, statusCode: StatusCodes.Status409Conflict);
                http.Response.Headers["Idempotency-Replayed"] = "true";
                return new CapturedResult(stored.ResponseStatus.Value, stored.ResponseBody ?? "");
        }

        // Release ONLY when the handler itself throws. Once the handler has returned it may have committed,
        // so from here on the claim is never released: a failure to capture/store the result, or a 5xx returned
        // by the handler, leaves the claim in place and a retry with the same key gets 409 IDEMPOTENCY_IN_PROGRESS
        // (safe: no duplicate execution) until a lease/expiry mechanism exists.
        object? raw;
        try { raw = await next(ctx); }
        catch
        {
            await store.ReleaseAsync(tenant, operation, key);
            throw;
        }

        var result = raw as IResult ?? (raw is null ? Results.NoContent() : Results.Json(raw));
        var captured = await CaptureAsync(http, result);
        if (captured.Status < 500)
        {
            try { await store.SetResultAsync(tenant, operation, key, captured.Status, captured.Body); }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to store idempotency result for {Operation} key {Key}; claim left in place", operation, key);
            }
        }
        return captured;
    }

    private static async Task<string> HashAsync(HttpRequest req)
    {
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        sha.AppendData(Encoding.UTF8.GetBytes($"{req.Method}\n{req.Path.Value}{req.QueryString.Value}\n"));
        if (req.Body.CanSeek) req.Body.Position = 0;
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms);
        if (req.Body.CanSeek) req.Body.Position = 0;
        sha.AppendData(ms.ToArray());
        return Convert.ToHexStringLower(sha.GetHashAndReset());
    }

    /// <summary>Runs the handler's result against a buffer so status and body can be stored, then returns an equivalent result.</summary>
    private static async Task<CapturedResult> CaptureAsync(HttpContext http, IResult result)
    {
        var original = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try { await result.ExecuteAsync(http); }
        finally { http.Response.Body = original; }
        var status = http.Response.StatusCode;
        http.Response.StatusCode = StatusCodes.Status200OK;
        return new CapturedResult(status, Encoding.UTF8.GetString(buffer.ToArray()));
    }
}

/// <summary>A stored (or just-captured) JSON response, written back verbatim.</summary>
public sealed class CapturedResult(int status, string body) : IResult
{
    public int Status { get; } = status;
    public string Body { get; } = body;

    public Task ExecuteAsync(HttpContext httpContext)
    {
        httpContext.Response.StatusCode = Status;
        httpContext.Response.ContentType = "application/json; charset=utf-8";
        return httpContext.Response.WriteAsync(Body, Encoding.UTF8);
    }
}
