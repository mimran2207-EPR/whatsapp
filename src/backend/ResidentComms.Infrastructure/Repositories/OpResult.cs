namespace ResidentComms.Infrastructure.Repositories;

/// <summary>Outcome of a repository operation: a value, or a stable error code (mapped to HTTP by the API layer).</summary>
public sealed record OpResult<T>(T? Value, string? Code = null, IReadOnlyDictionary<string, object?>? Details = null)
{
    public bool Ok => Code is null;
    public static OpResult<T> Success(T value) => new(value);
    public static OpResult<T> Fail(string code, IReadOnlyDictionary<string, object?>? details = null) => new(default, code, details);
}

public sealed record FindingDto(string Code, string Severity, string MessageHe, string Step);
