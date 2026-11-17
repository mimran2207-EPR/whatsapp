namespace ResidentComms.Api.Endpoints;

/// <summary>Upload limits for /v1/import-jobs. A mutable singleton so tests can lower them; production uses the defaults.</summary>
public sealed class ImportLimits
{
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;
    public long MaxUncompressedBytes { get; set; } = 100L * 1024 * 1024;
    public int MaxRows { get; set; } = 20_000;
    public int MaxColumns { get; set; } = 50;
}
