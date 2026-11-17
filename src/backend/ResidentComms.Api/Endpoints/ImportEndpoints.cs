using System.IO.Compression;
using System.Text.Json;
using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Import;
using ResidentComms.Infrastructure.Repositories;

namespace ResidentComms.Api.Endpoints;

public static class ImportEndpoints
{
    public const long MaxRequestBytes = 10 * 1024 * 1024;
    public const long MaxUncompressedBytes = 100L * 1024 * 1024;
    public const int MaxRows = 20_000;
    public const int MaxColumns = 50;

    private sealed record MappingDto(string? IdColumn, string? NameColumn, string? PhoneColumn, string[]? VariableColumns);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapImports(this RouteGroupBuilder v1)
    {
        // The body is read manually (not bound) so the idempotency filter can hash it first, and so limits are enforced before parsing.
        v1.MapPost("/import-jobs", async (HttpRequest req, ICurrentUser user, AudienceRepository audiences) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            if (req.ContentLength is > MaxRequestBytes) return ApiResults.Error("FILE_TOO_LARGE", StatusCodes.Status413PayloadTooLarge);
            if (!req.HasFormContentType) return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);

            IFormCollection form;
            try { form = await req.ReadFormAsync(); }
            catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException or IOException)
            { return ApiResults.Error(ex is BadHttpRequestException { StatusCode: 413 } ? "FILE_TOO_LARGE" : "VALIDATION_FAILED", ex is BadHttpRequestException { StatusCode: 413 } ? 413 : 400); }

            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0) return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
            if (file.Length > MaxRequestBytes) return ApiResults.Error("FILE_TOO_LARGE", StatusCodes.Status413PayloadTooLarge);

            MappingDto? dto;
            try { dto = JsonSerializer.Deserialize<MappingDto>(form["mapping"].ToString(), Json); }
            catch (JsonException) { dto = null; }
            if (dto is null || string.IsNullOrWhiteSpace(dto.IdColumn) || string.IsNullOrWhiteSpace(dto.PhoneColumn))
                return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
            var mapping = new ImportMapping(dto.IdColumn, string.IsNullOrWhiteSpace(dto.NameColumn) ? null : dto.NameColumn, dto.PhoneColumn, dto.VariableColumns ?? []);

            byte[] bytes;
            await using (var src = file.OpenReadStream())
            {
                using var ms = new MemoryStream();
                await src.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            var fileName = Path.GetFileName(file.FileName);
            if (Path.GetExtension(fileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                // Zip-bomb guard: inspect entry sizes before ClosedXML touches the file.
                try
                {
                    using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                    long total = 0;
                    foreach (var e in zip.Entries) total += e.Length;
                    if (total > MaxUncompressedBytes) return ApiResults.Error("FILE_TOO_LARGE", StatusCodes.Status413PayloadTooLarge);
                }
                catch (InvalidDataException) { return ApiResults.Error("UNSUPPORTED_FILE", StatusCodes.Status422UnprocessableEntity); }
            }

            SheetData sheet;
            try { sheet = SpreadsheetReader.Read(new MemoryStream(bytes), fileName); }
            catch (UnsupportedFileException) { return ApiResults.Error("UNSUPPORTED_FILE", StatusCodes.Status422UnprocessableEntity); }
            catch (Exception ex) when (ex is InvalidDataException or IOException or FormatException or InvalidOperationException or NullReferenceException)
            { return ApiResults.Error("UNREADABLE_FILE", StatusCodes.Status422UnprocessableEntity); }

            if (sheet.Headers.Count > MaxColumns) return ApiResults.Error("TOO_MANY_COLUMNS", StatusCodes.Status422UnprocessableEntity);
            if (sheet.Rows.Count > MaxRows) return ApiResults.Error("TOO_MANY_ROWS", StatusCodes.Status422UnprocessableEntity);

            IReadOnlyList<ValidatedRow> rows;
            try { rows = ImportValidator.Validate(sheet, mapping); }
            catch (ArgumentException) { return ApiResults.Error("MAPPING_COLUMN_NOT_FOUND", StatusCodes.Status422UnprocessableEntity); }

            var s = await audiences.SaveImportAsync(user.TenantId, user.UserId, fileName, bytes, form["audienceName"].ToString(), sheet, mapping, rows);
            return Results.Json(s, statusCode: StatusCodes.Status201Created);
        })
        .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxRequestBytes + 64 * 1024)); // + multipart overhead

        v1.MapGet("/import-jobs/{id:guid}/errors", async (Guid id, ICurrentUser user, AudienceRepository audiences) =>
        {
            var errors = await audiences.GetErrorsAsync(user.TenantId, id);
            return errors is null
                ? ApiResults.Error("NOT_FOUND", StatusCodes.Status404NotFound)
                : Results.Ok(errors);
        });
    }
}
