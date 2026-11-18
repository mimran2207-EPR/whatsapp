using System.Text.RegularExpressions;
namespace ResidentComms.Domain.Content;

public sealed record RenderResult(string Text, IReadOnlyList<string> MissingFields);

public static partial class TemplateRenderer
{
    [GeneratedRegex(@"\{([^{}]+)\}")] private static partial Regex Token();

    public static RenderResult Render(string template, IReadOnlyDictionary<string, string?> values, IReadOnlyDictionary<string, string>? defaults = null)
    {
        var missing = new List<string>();
        var text = Token().Replace(template, m =>
        {
            var key = m.Groups[1].Value;
            if (values.TryGetValue(key, out var v) && !string.IsNullOrEmpty(v)) return v;
            if (defaults is not null && defaults.TryGetValue(key, out var d)) return d;
            if (!missing.Contains(key)) missing.Add(key);
            return "";
        });
        return new(text, missing);
    }
}
