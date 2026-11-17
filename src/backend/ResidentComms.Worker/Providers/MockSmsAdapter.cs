using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ResidentComms.Infrastructure.Events;

namespace ResidentComms.Worker.Providers;

/// <summary>Bound from "Providers:MockSms". SigningKey comes from user-secrets / environment, never from the repo.</summary>
public sealed class MockSmsOptions
{
    public double AcceptRate { get; set; } = 0.9;
    public double RejectRate { get; set; } = 0.02;
    public double TimeoutRate { get; set; } = 0.03;       // remainder (5% by default) = request never left (throws)
    public double DeliverRate { get; set; } = 0.85;       // of accepted
    public double FailRate { get; set; } = 0.03;          // of accepted; the rest stays "sent"
    public double DuplicateEventRate { get; set; } = 0.05;
    public int MaxEventDelaySeconds { get; set; } = 20;
    public int? Seed { get; set; }
    public string? SigningKey { get; set; }
    public string CallbackBaseUrl { get; set; } = "http://localhost:5080";

    /// <summary>Webhook redelivery schedule (ms) after a refused or failed POST, like a real provider's retries.</summary>
    public int[] WebhookRetryDelaysMs { get; set; } = [1000, 2000, 4000, 8000, 16000];

    /// <summary>Test hook: force the outcome (ACCEPTED/REJECTED/AMBIGUOUS/LOCAL_FAILURE) for specific messages.</summary>
    public ConcurrentDictionary<Guid, string> ForcedOutcomes { get; } = new();
}

/// <summary>Simulated SMS provider. Everything it produces is sandbox data. Events go out through <see cref="IProviderEventPoster"/>.</summary>
public sealed class MockSmsAdapter : ISmsAdapter
{
    private const int MinEventDelayMs = 300; // lets the dispatcher commit provider_message_id before the first event arrives

    private readonly MockSmsOptions _o;
    private readonly IProviderEventPoster _poster;
    private readonly ILogger<MockSmsAdapter>? _log;
    private readonly Random _rng;
    private readonly object _lock = new();

    public MockSmsAdapter(MockSmsOptions options, IProviderEventPoster poster, ILogger<MockSmsAdapter>? log = null)
    {
        _o = options; _poster = poster; _log = log;
        _rng = options.Seed is { } s ? new Random(s) : new Random();
    }

    private double Roll() { lock (_lock) return _rng.NextDouble(); }

    public Task<SendOutcome> SendAsync(SmsSendRequest r, CancellationToken ct)
    {
        string kind;
        if (_o.ForcedOutcomes.TryGetValue(r.MessageId, out var forced)) kind = forced;
        else
        {
            var x = Roll();
            kind = x < _o.AcceptRate ? SendOutcome.Accepted
                : x < _o.AcceptRate + _o.RejectRate ? SendOutcome.Rejected
                : x < _o.AcceptRate + _o.RejectRate + _o.TimeoutRate ? SendOutcome.Ambiguous
                : "LOCAL_FAILURE";
        }

        switch (kind)
        {
            case SendOutcome.Rejected: return Task.FromResult(new SendOutcome(SendOutcome.Rejected, null, "MOCK_INVALID_DESTINATION"));
            case SendOutcome.Ambiguous: return Task.FromResult(new SendOutcome(SendOutcome.Ambiguous, null, "MOCK_TIMEOUT"));
            case SendOutcome.Accepted:
                var providerMessageId = "mock-" + Guid.NewGuid().ToString("N");
                Schedule(providerMessageId);
                return Task.FromResult(new SendOutcome(SendOutcome.Accepted, providerMessageId, null));
            default: throw new HttpRequestException("Mock provider unreachable (simulated: the request never left).");
        }
    }

    // Fire-and-forget by design: a real provider calls back on its own schedule.
    private void Schedule(string pm)
    {
        var plan = new List<(string Type, int DelayMs, bool Duplicate)>
        {
            ("sent", MinEventDelayMs + (int)(Roll() * _o.MaxEventDelaySeconds * 1000), Roll() < _o.DuplicateEventRate),
        };
        var final = Roll();
        var finalType = final < _o.DeliverRate ? "delivered" : final < _o.DeliverRate + _o.FailRate ? "failed" : null;
        if (finalType is not null) // independent delay: the final event may overtake "sent" (out of order)
            plan.Add((finalType, MinEventDelayMs + (int)(Roll() * _o.MaxEventDelaySeconds * 1000), Roll() < _o.DuplicateEventRate));

        foreach (var (type, delay, dup) in plan)
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(delay);
                    var body = JsonSerializer.Serialize(new { providerEventId = $"{pm}:{type}", providerMessageId = pm, type, occurredAt = DateTimeOffset.UtcNow });
                    await PostWithRetry(body, type, pm);
                    if (dup) { await Task.Delay(100); await PostWithRetry(body, type, pm); }
                }
                catch (Exception ex) { _log?.LogWarning(ex, "Mock provider could not deliver event {Type} for {Pm}", type, pm); }
            });
    }

    /// <summary>
    /// An event can reach the API before the dispatcher has committed provider_message_id; the API then refuses it
    /// (422, nothing to attribute it to). Like a real provider, redeliver on the configured schedule instead of dropping it.
    /// Redelivery is safe: the API deduplicates by provider event id.
    /// </summary>
    private async Task PostWithRetry(string body, string type, string pm)
    {
        for (var attempt = 0; ; attempt++)
        {
            try { await Post(body); return; }
            catch (Exception ex) when (attempt < _o.WebhookRetryDelaysMs.Length)
            {
                _log?.LogInformation(ex, "Mock provider will redeliver event {Type} for {Pm} (attempt {Attempt})", type, pm, attempt + 2);
                await Task.Delay(_o.WebhookRetryDelaysMs[attempt]);
            }
        }
    }

    private Task Post(string body)
    {
        var key = _o.SigningKey ?? throw new InvalidOperationException("Providers:MockSms:SigningKey is not configured.");
        return _poster.PostAsync(body, MockSignature.Compute(key, Encoding.UTF8.GetBytes(body)), CancellationToken.None);
    }
}
