using System.Text;
using ResidentComms.Infrastructure.Import;
using ResidentComms.TestShared;

namespace ResidentComms.Infrastructure.Tests.Import;

public class SpreadsheetReaderTests
{
    [Fact] public void Xlsx_reads_values_as_strings_and_never_evaluates_formulas()
    {
        using var s = Fixtures.Xlsx();
        var sheet = SpreadsheetReader.Read(s, "הורי גנים.xlsx");
        Assert.Equal("נובמבר", sheet.SheetName);
        var formulaRow = sheet.Rows.Single(r => r[4] == Fixtures.FormulaRowId);
        Assert.Equal("=1+1", formulaRow[2]);
        var lostZeroRow = sheet.Rows.Single(r => r[4] == Fixtures.LostZeroRowId);
        Assert.Equal("521234567", lostZeroRow[3]);
    }

    [Fact] public void Csv_windows_1255_is_detected()
    {
        using var s = Fixtures.CsvWindows1255();
        var sheet = SpreadsheetReader.Read(s, "a.csv");
        Assert.Equal("windows-1255", sheet.DetectedEncoding);
        Assert.Equal("שם הורה", sheet.Headers[2]);
        Assert.Equal("כהן, יובל", sheet.Rows[1][1]);
        Assert.Equal("אבא \"הגדול\"", sheet.Rows[1][2]);
    }

    [Fact] public void Csv_utf8_with_bom_is_detected()
    {
        var bytes = new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes("א,ב\r\n1,2\r\n")).ToArray();
        var sheet = SpreadsheetReader.Read(new MemoryStream(bytes), "a.csv");
        Assert.Equal("utf-8-bom", sheet.DetectedEncoding);
        Assert.Equal("א", sheet.Headers[0]);
    }

    [Fact] public void Unsupported_extension_throws()
        => Assert.Throws<UnsupportedFileException>(() => SpreadsheetReader.Read(new MemoryStream(), "a.xls"));
}

public class ImportValidatorTests
{
    private static readonly ImportMapping Map = new("ת.ז", "שם הורה", "טל נייד הורה", ["שם ילד", "גן"]);

    [Fact] public void Flags_lost_zero_scientific_id_formula_and_duplicate()
    {
        using var s = Fixtures.Xlsx();
        var rows = ImportValidator.Validate(SpreadsheetReader.Read(s, "x.xlsx"), Map);
        Assert.Contains(rows, r => r.State == "VALID" && r.Phone.Normalized == "+972521234567");
        Assert.Contains(rows, r => r.Codes.Contains("LostLeadingZero") && r.State == "INVALID");
        Assert.Contains(rows, r => r.Codes.Contains("ID_SCIENTIFIC"));
        Assert.Contains(rows, r => r.Codes.Contains("FORMULA_VALUE"));
        Assert.Single(rows, r => r.Codes.Contains("DUPLICATE_ID"));
        var first = rows.Single(r => r.SourceRecipientId == Fixtures.DuplicateId && !r.Codes.Contains("DUPLICATE_ID"));
        Assert.Equal("VALID", first.State);
        Assert.Equal("ID:" + Fixtures.DuplicateId, first.IdentityKey);
    }
}
