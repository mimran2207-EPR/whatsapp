namespace ResidentComms.Worker.Providers;

public sealed record SmsSendRequest(Guid MessageId, string To, string Text, string IdempotencyKey);

/// <summary>Kind: ACCEPTED | REJECTED | AMBIGUOUS (the request may have left but no answer arrived).</summary>
public sealed record SendOutcome(string Kind, string? ProviderMessageId, string? ErrorCode)
{
    public const string Accepted = "ACCEPTED", Rejected = "REJECTED", Ambiguous = "AMBIGUOUS";
}

/// <summary>
/// The request provably never reached the provider (connection refused, DNS failure, local setup error before any byte was sent).
/// The ONLY exception the dispatcher treats as LOCAL_FAILURE (retry with backoff, same idempotency key).
/// </summary>
public sealed class ProviderNotReachedException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Contract: return AMBIGUOUS for a timeout after the request left. Throw <see cref="ProviderNotReachedException"/> ONLY when the
/// request provably never left (retried with backoff). Any other exception, including TaskCanceledException/timeouts,
/// is treated by the dispatcher as AMBIGUOUS (handoff UNKNOWN): never retried, never resent blindly.
/// </summary>
public interface ISmsAdapter
{
    Task<SendOutcome> SendAsync(SmsSendRequest r, CancellationToken ct);
}

/// <summary>Posts a signed provider event to the API (HTTP in production; the test server client in tests).</summary>
public interface IProviderEventPoster
{
    Task PostAsync(string body, string signatureHex, CancellationToken ct);
}

public sealed class HttpProviderEventPoster(HttpClient http) : IProviderEventPoster
{
    public const string Path = "/v1/provider-events/mock-sms";

    public async Task PostAsync(string body, string signatureHex, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, Path) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        req.Headers.Add(ResidentComms.Infrastructure.Events.MockSignature.HeaderName, signatureHex);
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
    }
}
