using System.Text.RegularExpressions;
using ResidentComms.Domain.Import;

namespace ResidentComms.Infrastructure.Import;

public record ImportMapping(string IdColumn, string? NameColumn, string PhoneColumn, IReadOnlyList<string> VariableColumns);

public record ValidatedRow(
    int SourceRowNumber,
    string SourceRecipientId,
    string IdentityKey,
    string? Name,
    PhoneResult Phone,
    IReadOnlyDictionary<string, string?> Variables,
    string State,
    IReadOnlyList<string> Codes);

public static partial class ImportValidator
{
    [GeneratedRegex(@"^\d(\.\d+)?E\+\d+$", RegexOptions.IgnoreCase)] private static partial Regex Scientific();

    /// <summary>SourceRowNumber is the true 1-based spreadsheet row (carried from the reader, so skipped blank rows are accounted for).</summary>
    public static IReadOnlyList<ValidatedRow> Validate(SheetData sheet, ImportMapping map)
    {
        int Col(string name)
        {
            var i = sheet.Headers.ToList().IndexOf(name);
            return i >= 0 ? i : throw new ArgumentException($"Column '{name}' not found in sheet.", nameof(map));
        }
        var idCol = Col(map.IdColumn);
        var phoneCol = Col(map.PhoneColumn);
        int? nameCol = map.NameColumn is null ? null : Col(map.NameColumn);
        var varCols = map.VariableColumns.Select(v => (Name: v, Index: Col(v))).ToList();

        static string? Cell(IReadOnlyList<string?> row, int i) => i < row.Count ? row[i] : null;

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<ValidatedRow>();
        for (var n = 0; n < sheet.Rows.Count; n++)
        {
            var row = sheet.Rows[n];
            var id = (Cell(row, idCol) ?? "").Trim();
            var name = nameCol is null ? null : Cell(row, nameCol.Value);
            var phone = PhoneNormalizer.NormalizeIsraeliMobile(Cell(row, phoneCol));
            var vars = varCols.ToDictionary(v => v.Name, v => Cell(row, v.Index));

            var codes = new List<string>();
            foreach (var flag in Enum.GetValues<PhoneIssue>())
                if (flag != PhoneIssue.None && phone.Issues.HasFlag(flag)) codes.Add(flag.ToString());

            var mapped = new List<string?> { id, name, Cell(row, phoneCol) };
            mapped.AddRange(vars.Values);
            if (mapped.Any(v => v is not null && v.TrimStart().StartsWith('='))) codes.Add("FORMULA_VALUE");
            if (id.Length == 0) codes.Add("MISSING_ID");
            if (Scientific().IsMatch(id)) codes.Add("ID_SCIENTIFIC");

            var key = "ID:" + id;
            if (id.Length > 0 && !seen.Add(key)) codes.Add("DUPLICATE_ID");

            result.Add(new ValidatedRow(sheet.RowNumbers[n], id, key, name, phone, vars,
                codes.Count == 0 ? "VALID" : "INVALID", codes));
        }
        return result;
    }
}
