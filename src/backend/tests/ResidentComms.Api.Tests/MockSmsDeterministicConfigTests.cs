using System.Text.Json;
using Microsoft.Extensions.Configuration;
using ResidentComms.Infrastructure.Events;
using ResidentComms.Worker.Providers;

namespace ResidentComms.Api.Tests;

/// <summary>
/// The Playwright E2E makes the mock deterministic only through configuration (Providers__MockSms__* environment variables).
/// This pins that contract: those exact keys bind to the options and give every message exactly one "sent" and one "delivered" event.
/// </summary>
public class MockSmsDeterministicConfigTests
{
    private sealed class RecordingPoster : IProviderEventPoster
    {
        public readonly List<string> Bodies = [];
        public Task PostAsync(string body, string signatureHex, CancellationToken ct) { lock (Bodies) Bodies.Add(body); return Task.CompletedTask; }
    }

    [Fact] public async Task E2e_environment_keys_make_every_message_accepted_and_delivered_exactly_once()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Providers:MockSms:SigningKey"] = ApiFactory.TestMockSmsKey,
            ["Providers:MockSms:AcceptRate"] = "1", ["Providers:MockSms:RejectRate"] = "0", ["Providers:MockSms:TimeoutRate"] = "0",
            ["Providers:MockSms:DeliverRate"] = "1", ["Providers:MockSms:FailRate"] = "0", ["Providers:MockSms:DuplicateEventRate"] = "0",
            ["Providers:MockSms:MaxEventDelaySeconds"] = "0",
        }).Build();
        var options = new MockSmsOptions();
        config.GetSection("Providers:MockSms").Bind(options);

        var poster = new RecordingPoster();
        using var adapter = new MockSmsAdapter(options, poster);
        const int n = 25;
        for (var i = 0; i < n; i++)
            Assert.Equal(SendOutcome.Accepted, (await adapter.SendAsync(new SmsSendRequest(Guid.NewGuid(), "+972521110001", "x", $"k{i}"), CancellationToken.None)).Kind);

        for (var i = 0; i < 100 && poster.Bodies.Count < 2 * n; i++) await Task.Delay(50);
        string[] types;
        lock (poster.Bodies) types = poster.Bodies.Select(b => JsonDocument.Parse(b).RootElement.GetProperty("type").GetString()!).ToArray();
        Assert.Equal(n, types.Count(t => t == "sent"));
        Assert.Equal(n, types.Count(t => t == "delivered"));
        Assert.Equal(2 * n, types.Length); // no failed, no duplicates
    }
}
