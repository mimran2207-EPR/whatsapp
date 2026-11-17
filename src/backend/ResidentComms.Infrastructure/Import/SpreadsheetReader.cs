using System.Text;
using ClosedXML.Excel;

namespace ResidentComms.Infrastructure.Import;

public record SheetData(
    IReadOnlyList<string> Headers,
    IReadOnlyList<IReadOnlyList<string?>> Rows,
    string? SheetName,
    string? DetectedEncoding);

public class UnsupportedFileException(string message) : Exception(message);

/// <summary>Reads XLSX/CSV as strings only. Formulas are never evaluated; numbers are never coerced.</summary>
public static class SpreadsheetReader
{
    static SpreadsheetReader() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static SheetData Read(Stream content, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".xlsx" => ReadXlsx(content),
            ".csv" => ReadCsv(content),
            _ => throw new UnsupportedFileException($"Unsupported file type '{ext}'. Use .xlsx or .csv."),
        };
    }

    private static SheetData ReadXlsx(Stream content)
    {
        using var wb = new XLWorkbook(content);
        var ws = wb.Worksheets.FirstOrDefault(w => w.Visibility == XLWorksheetVisibility.Visible) ?? wb.Worksheets.First();
        var used = ws.RangeUsed();
        if (used is null) return new SheetData([], [], ws.Name, null);

        var firstRow = used.FirstRow().RowNumber();
        var lastRow = used.LastRow().RowNumber();
        var firstCol = used.FirstColumn().ColumnNumber();
        var lastCol = used.LastColumn().ColumnNumber();

        var headers = new List<string>();
        for (var c = firstCol; c <= lastCol; c++) headers.Add((CellText(ws.Cell(firstRow, c)) ?? "").Trim());

        var rows = new List<IReadOnlyList<string?>>();
        for (var r = firstRow + 1; r <= lastRow; r++)
        {
            var row = new List<string?>();
            for (var c = firstCol; c <= lastCol; c++) row.Add(CellText(ws.Cell(r, c)));
            if (row.All(string.IsNullOrWhiteSpace)) continue;
            rows.Add(row);
        }
        return new SheetData(headers, rows, ws.Name, null);
    }

    private static string? CellText(IXLCell cell)
    {
        if (cell.HasFormula) return "=" + cell.FormulaA1.TrimStart('=');
        if (cell.IsEmpty()) return null;
        var text = cell.GetFormattedString();
        return string.IsNullOrEmpty(text) ? null : text;
    }

    private static SheetData ReadCsv(Stream content)
    {
        using var ms = new MemoryStream();
        content.CopyTo(ms);
        var bytes = ms.ToArray();

        string text, encodingName;
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            text = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
            encodingName = "utf-8-bom";
        }
        else
        {
            try
            {
                text = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes);
                encodingName = "utf-8";
            }
            catch (DecoderFallbackException)
            {
                text = Encoding.GetEncoding(1255).GetString(bytes);
                encodingName = "windows-1255";
            }
        }

        var records = ParseCsv(text).Where(r => !r.All(string.IsNullOrWhiteSpace)).ToList();
        if (records.Count == 0) return new SheetData([], [], null, encodingName);

        var headers = records[0].Select(h => (h ?? "").Trim()).ToList();
        var rows = records.Skip(1)
            .Select(r => (IReadOnlyList<string?>)r.Select(v => string.IsNullOrEmpty(v) ? null : v).ToList())
            .ToList();
        return new SheetData(headers, rows, null, encodingName);
    }

    /// <summary>Minimal RFC-4180 parser: quoted fields, embedded commas/quotes/newlines.</summary>
    private static List<List<string?>> ParseCsv(string text)
    {
        var records = new List<List<string?>>();
        var row = new List<string?>();
        var field = new StringBuilder();
        var inQuotes = false;
        var any = false;

        void EndField() { row.Add(field.ToString()); field.Clear(); }
        void EndRecord()
        {
            EndField();
            records.Add(row);
            row = [];
            any = false;
        }

        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                    else inQuotes = false;
                }
                else field.Append(ch);
                continue;
            }
            switch (ch)
            {
                case '"': inQuotes = true; any = true; break;
                case ',': EndField(); any = true; break;
                case '\r': if (i + 1 < text.Length && text[i + 1] == '\n') i++; EndRecord(); break;
                case '\n': EndRecord(); break;
                default: field.Append(ch); any = true; break;
            }
        }
        if (any || field.Length > 0) EndRecord();
        return records;
    }
}
