using System.Text;
using ClosedXML.Excel;

namespace ResidentComms.TestShared;

/// <summary>In-memory import fixtures (no binary files in the repo).</summary>
public static class Fixtures
{
    public const string ValidRowId = "200000001";
    public const string FormulaRowId = "200000002";
    public const string LostZeroRowId = "200000003";
    public const string DuplicateId = "200000004";
    public const string MissingChildRowId = "200000006";
    public const string ScientificIdText = "1.23E+08";

    public static readonly string[] Headers = ["גן", "שם ילד", "שם הורה", "טל נייד הורה", "ת.ז"];

    static Fixtures() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static byte[] XlsxBytes()
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("נובמבר");
        for (var c = 0; c < Headers.Length; c++) ws.Cell(1, c + 1).Value = Headers[c];
        var r = 2;
        void Row(string gan, string? child, string parent, string phone, string id)
        {
            ws.Cell(r, 1).Value = gan;
            if (child is not null) ws.Cell(r, 2).Value = child;
            ws.Cell(r, 3).Value = parent;
            ws.Cell(r, 4).Value = phone;
            ws.Cell(r, 5).Value = id;
            r++;
        }
        Row("תפוח", "נועה", "דנה כהן", "052-1234567", ValidRowId);
        Row("תפוח", "יובל", "x", "0521111111", FormulaRowId);          // formula in "שם הורה"
        ws.Cell(r - 1, 3).FormulaA1 = "1+1";
        Row("דובדבן", "איתי", "רונית לוי", "x", LostZeroRowId);         // phone stored as a NUMBER
        ws.Cell(r - 1, 4).Value = 521234567;
        Row("דובדבן", "מאיה", "יעל בר", "0523333333", DuplicateId);
        Row("דובדבן", "תמר", "יעל בר", "0523333334", DuplicateId);
        Row("תפוח", null, "משה פרץ", "0524444444", MissingChildRowId);  // empty "שם ילד"
        Row("תפוח", "ליאם", "אורי גל", "0525555555", ScientificIdText);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public static Stream Xlsx() => new MemoryStream(XlsxBytes());

    public static Stream CsvWindows1255()
    {
        var csv = string.Join("\r\n",
            string.Join(",", Headers),
            $"תפוח,נועה,דנה כהן,052-1234567,{ValidRowId}",
            $"תפוח,\"כהן, יובל\",\"אבא \"\"הגדול\"\"\",0521111111,{FormulaRowId}") + "\r\n";
        return new MemoryStream(Encoding.GetEncoding(1255).GetBytes(csv));
    }
}
