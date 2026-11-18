using System.IO.Compression;
using System.Text.Json;
using ResidentComms.Api.Auth;
using ResidentComms.Infrastructure.Import;
using ResidentComms.Infrastructure.Repositories;

namespace ResidentComms.Api.Endpoints;

public static class ImportEndpoints
{
    // Hard transport ceiling (file limit + multipart overhead); the file itself is compared to ImportLimits.MaxFileBytes.
    private const long TransportCeilingBytes = 10 * 1024 * 1024 + 64 * 1024;

    private sealed record MappingDto(string? IdColumn, string? NameColumn, string? PhoneColumn, string[]? VariableColumns);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapImports(this RouteGroupBuilder v1)
    {
        // The body is read manually (not bound) so the idempotency filter can hash it first, and so limits are enforced before parsing.
        v1.MapPost("/import-jobs", async (HttpRequest req, ICurrentUser user, AudienceRepository audiences, ImportLimits limits) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole();
            if (!req.HasFormContentType) return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);

            IFormCollection form;
            try { form = await req.ReadFormAsync(); }
            catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException or IOException)
            { return ApiResults.Error(ex is BadHttpRequestException { StatusCode: 413 } ? "FILE_TOO_LARGE" : "VALIDATION_FAILED", ex is BadHttpRequestException { StatusCode: 413 } ? 413 : 400); }

            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0) return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
            if (file.Length > limits.MaxFileBytes) return ApiResults.Error("FILE_TOO_LARGE", StatusCodes.Status413PayloadTooLarge);

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
                // An .xlsx is a zip: reject a spoofed extension by its signature (PK\x03\x04).
                if (bytes.Length < 4 || bytes[0] != 0x50 || bytes[1] != 0x4B || bytes[2] != 0x03 || bytes[3] != 0x04)
                    return ApiResults.Error("UNSUPPORTED_FILE", StatusCodes.Status422UnprocessableEntity);
                // Zip-bomb guard on ACTUAL decompressed bytes (entry headers can lie): stream every entry to Stream.Null under a running cap.
                try
                {
                    using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                    long total = 0;
                    var buffer = new byte[81920];
                    foreach (var e in zip.Entries)
                    {
                        await using var entry = e.Open();
                        int n;
                        while ((n = await entry.ReadAsync(buffer)) > 0)
                        {
                            total += n;
                            if (total > limits.MaxUncompressedBytes)
                                return ApiResults.Error("FILE_TOO_LARGE_UNCOMPRESSED", StatusCodes.Status422UnprocessableEntity);
                        }
                    }
                }
                catch (InvalidDataException) { return ApiResults.Error("UNSUPPORTED_FILE", StatusCodes.Status422UnprocessableEntity); }
            }

            SheetData sheet;
            try { sheet = SpreadsheetReader.Read(new MemoryStream(bytes), fileName); }
            catch (UnsupportedFileException) { return ApiResults.Error("UNSUPPORTED_FILE", StatusCodes.Status422UnprocessableEntity); }
            catch (Exception ex) when (ex is InvalidDataException or IOException or FormatException or InvalidOperationException or NullReferenceException)
            { return ApiResults.Error("UNREADABLE_FILE", StatusCodes.Status422UnprocessableEntity); }

            if (sheet.Headers.Count > limits.MaxColumns) return ApiResults.Error("TOO_MANY_COLUMNS", StatusCodes.Status422UnprocessableEntity);
            if (sheet.Rows.Count > limits.MaxRows) return ApiResults.Error("TOO_MANY_ROWS", StatusCodes.Status422UnprocessableEntity);

            IReadOnlyList<ValidatedRow> rows;
            try { rows = ImportValidator.Validate(sheet, mapping); }
            catch (ArgumentException) { return ApiResults.Error("MAPPING_COLUMN_NOT_FOUND", StatusCodes.Status422UnprocessableEntity); }

            var s = await audiences.SaveImportAsync(user.TenantId, user.UserId, fileName, bytes, form["audienceName"].ToString(), sheet, mapping, rows);
            return Results.Json(s, statusCode: StatusCodes.Status201Created);
        })
        .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(TransportCeilingBytes));

        v1.MapGet("/import-jobs/{id:guid}/errors", async (Guid id, ICurrentUser user, AudienceRepository audiences) =>
        {
            if (!ApiResults.CanAuthor(user)) return ApiResults.ForbiddenRole(); // error rows carry (masked) recipient ids: same roles as the import itself
            var errors = await audiences.GetErrorsAsync(user.TenantId, id);
            return errors is null
                ? ApiResults.Error("NOT_FOUND", StatusCodes.Status404NotFound)
                : Results.Ok(errors);
        });
    }
}
