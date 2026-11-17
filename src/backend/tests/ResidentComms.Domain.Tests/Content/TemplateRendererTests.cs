using ResidentComms.Domain.Content;
namespace ResidentComms.Domain.Tests.Content;
public class TemplateRendererTests
{
    [Fact]
    public void Replaces_tokens_and_reports_missing_fields()
    {
        var r = TemplateRenderer.Render("שלום {שם_הורה}, תזכורת עבור {שם_ילד}.",
            new Dictionary<string, string?> { ["שם_הורה"] = "רונית", ["שם_ילד"] = null });
        Assert.Equal("שלום רונית, תזכורת עבור .", r.Text);
        Assert.Equal(new[] { "שם_ילד" }, r.MissingFields);
    }

    [Fact]
    public void Default_value_resolves_a_missing_field()
    {
        var r = TemplateRenderer.Render("עבור {שם_ילד}", new Dictionary<string, string?>(),
            new Dictionary<string, string> { ["שם_ילד"] = "ילדכם" });
        Assert.Equal("עבור ילדכם", r.Text);
        Assert.Empty(r.MissingFields);
    }
}
