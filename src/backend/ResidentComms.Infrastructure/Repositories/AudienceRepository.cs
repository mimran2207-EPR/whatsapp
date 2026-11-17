using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using ResidentComms.Domain.Import;
using ResidentComms.Infrastructure.Import;
using ResidentComms.Infrastructure.Sql;

namespace ResidentComms.Infrastructure.Repositories;

public sealed record ImportSampleRow(int Row, string SourceRecipientId, string? Name, string Phone, string State, IReadOnlyList<string> Codes);

public sealed record ImportSummary(
    Guid ImportRunId, Guid AudienceId, Guid AudienceVersionId, int RowCount, int ValidCount, int InvalidCount,
    IReadOnlyDictionary<string, int> Codes, IReadOnlyList<ImportSampleRow> Sample);

public sealed record ImportErrorRow(int Row, string SourceRecipientId, IReadOnlyList<string> Codes);

public sealed class AudienceRepository(SqlConnectionFactory db, TimeProvider clock)
{
    /// <summary>Persists an import (audience, version, run, members) in one transaction; commits as the last step.</summary>
    public async Task<ImportSummary> SaveImportAsync(Guid tenant, string userId, string fileName, byte[] fileBytes, string? audienceName,
        SheetData sheet, ImportMapping mapping, IReadOnlyList<ValidatedRow> rows)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var audienceId = Guid.NewGuid(); var versionId = Guid.NewGuid(); var runId = Guid.NewGuid();
        var name = string.IsNullOrWhiteSpace(audienceName) ? Path.GetFileNameWithoutExtension(fileName) : audienceName.Trim();
        if (name.Length == 0) name = "קהל";
        if (name.Length > 200) name = name[..200];

        await using var c = await db.OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        await c.ExecuteAsync("INSERT Audience(audience_id, tenant_id, name, audience_kind, owner_id) VALUES (@audienceId, @tenant, @name, 'FILE', @userId)",
            new { audienceId, tenant, name, userId }, tx);
        await c.ExecuteAsync("INSERT AudienceVersion(audience_version_id, tenant_id, audience_id, version_no, source_loaded_at) VALUES (@versionId, @tenant, @audienceId, 1, @now)",
            new { versionId, tenant, audienceId, now }, tx);

        var valid = rows.Count(r => r.State == "VALID");
        await c.ExecuteAsync(
            @"INSERT ImportRun(import_run_id, tenant_id, audience_version_id, source_object_name, source_sha256, detected_encoding, sheet_name, row_count, valid_count, created_by)
              VALUES (@runId, @tenant, @versionId, @src, @sha, @enc, @sheet, @rowCount, @valid, @userId)",
            new
            {
                runId, tenant, versionId, src = fileName.Length > 260 ? fileName[..260] : fileName,
                sha = Convert.ToHexStringLower(SHA256.HashData(fileBytes)), enc = sheet.DetectedEncoding, sheet = sheet.SheetName,
                rowCount = rows.Count, valid, userId,
            }, tx);

        var table = new DataTable();
        foreach (var col in new[] { "audience_member_id", "tenant_id", "audience_version_id", "source_row_number", "source_recipient_id",
                     "approved_identity_key", "recipient_name", "phone_raw", "phone_normalized", "variables_json", "validation_state", "validation_codes" })
            table.Columns.Add(col, col is "audience_member_id" or "tenant_id" or "audience_version_id" ? typeof(Guid) : col == "source_row_number" ? typeof(int) : typeof(string));

        var usedKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            // UQ_AudienceMember_Identity: the first row keeps the plain key; a repeated or empty ID (always INVALID) gets a row-specific key.
            var key = r.IdentityKey.Length > 190 ? r.IdentityKey[..190] : r.IdentityKey;
            if (!usedKeys.Add(key)) { key = $"{key}#row{r.SourceRowNumber}"; usedKeys.Add(key); }

            var vars = new Dictionary<string, string?>(r.Variables);
            if (mapping.NameColumn is not null) vars.TryAdd(mapping.NameColumn, r.Name);

            table.Rows.Add(Guid.NewGuid(), tenant, versionId, r.SourceRowNumber, Trunc(r.SourceRecipientId, 100), key,
                (object?)Trunc(r.Name, 200) ?? DBNull.Value, (object?)Trunc(r.Phone.Raw, 100) ?? DBNull.Value, (object?)r.Phone.Normalized ?? DBNull.Value,
                JsonSerializer.Serialize(vars, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }),
                r.State, r.Codes.Count == 0 ? DBNull.Value : Trunc(string.Join(",", r.Codes), 400)!);
        }

        using (var bulk = new SqlBulkCopy(c, SqlBulkCopyOptions.CheckConstraints, tx) { DestinationTableName = "AudienceMember", BulkCopyTimeout = 120 })
        {
            foreach (DataColumn col in table.Columns) bulk.ColumnMappings.Add(col.ColumnName, col.ColumnName);
            await bulk.WriteToServerAsync(table);
        }

        var codesCount = rows.SelectMany(r => r.Codes).GroupBy(x => x).ToDictionary(g => g.Key, g => g.Count());
        var sample = rows.Take(5).Select(r => new ImportSampleRow(r.SourceRowNumber, IdentityMask.MaskId(r.SourceRecipientId), IdentityMask.MaskName(r.Name),
            PhoneMask.Mask(r.Phone.Normalized ?? r.Phone.Raw), r.State, r.Codes)).ToList();

        await tx.CommitAsync();
        return new ImportSummary(runId, audienceId, versionId, rows.Count, valid, rows.Count - valid, codesCount, sample);
    }

    private static string? Trunc(string? s, int max) => s is null ? null : s.Length > max ? s[..max] : s;

    /// <summary>Rows of an import that are not VALID. Null when the import run does not exist for the tenant.</summary>
    public async Task<IReadOnlyList<ImportErrorRow>?> GetErrorsAsync(Guid tenant, Guid importRunId)
    {
        await using var c = await db.OpenAsync();
        var versionId = await c.QuerySingleOrDefaultAsync<Guid?>(
            "SELECT audience_version_id FROM ImportRun WHERE tenant_id = @tenant AND import_run_id = @importRunId", new { tenant, importRunId });
        if (versionId is null) return null;
        var rows = await c.QueryAsync<(int Row, string Id, string? Codes)>(
            @"SELECT source_row_number AS Row, source_recipient_id AS Id, validation_codes AS Codes FROM AudienceMember
              WHERE tenant_id = @tenant AND audience_version_id = @versionId AND validation_state <> 'VALID' ORDER BY source_row_number",
            new { tenant, versionId });
        return rows.Select(r => new ImportErrorRow(r.Row, IdentityMask.MaskId(r.Id), string.IsNullOrEmpty(r.Codes) ? [] : r.Codes.Split(','))).ToList();
    }
}
