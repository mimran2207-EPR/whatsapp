using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Repositories;

namespace ResidentComms.Api.Endpoints;

public static class ApiResults
{
    public static IResult Error(string code, int status, IReadOnlyDictionary<string, object?>? details = null)
    {
        var body = new Dictionary<string, object?> { ["code"] = code };
        if (details is not null) foreach (var (k, v) in details) body[k] = v;
        return Results.Json(body, statusCode: status);
    }

    public static int StatusFor(string code) => code switch
    {
        "NOT_FOUND" => StatusCodes.Status404NotFound,
        "FORBIDDEN_ROLE" or "FORBIDDEN_DEPARTMENT" or "NOT_APPROVER" or "SELF_APPROVAL_ABOVE_THRESHOLD" => StatusCodes.Status403Forbidden,
        "STALE_REVISION" or "APPROVAL_INVALID" or "ALREADY_RELEASED" or "INVALID_STATE" => StatusCodes.Status409Conflict,
        "VALIDATION_FAILED" => StatusCodes.Status400BadRequest,
        "FILE_TOO_LARGE" => StatusCodes.Status413PayloadTooLarge,
        _ => StatusCodes.Status422UnprocessableEntity,
    };

    public static IResult From<T>(OpResult<T> r, Func<T, IResult> ok)
        => r.Ok ? ok(r.Value!) : Error(r.Code!, StatusFor(r.Code!), r.Details);

    /// <summary>create/patch/submit/preflight/import: creator, or approver (who may also create). Analyst is read-only.</summary>
    public static bool CanAuthor(ICurrentUser u) => u.Role is "creator" or "approver";

    public static bool CanApprove(ICurrentUser u) => u.Role == "approver";

    public static IResult ForbiddenRole() => Error("FORBIDDEN_ROLE", StatusCodes.Status403Forbidden);
}
