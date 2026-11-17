using System.Text.Json;
using ResidentComms.Infrastructure.Events;

namespace ResidentComms.Api.Endpoints;

public static class ProviderEventEndpoints
{
    private const int MaxBodyBytes = 64 * 1024;

    /// <summary>
    /// Anonymous (the provider has no JWT) but signature-verified: HMAC over the raw body is checked BEFORE the body is parsed or stored.
    /// Excluded from the idempotency filter; the deduplication key makes retries safe instead.
    /// </summary>
    public static void MapProviderEvents(this RouteGroupBuilder v1)
    {
        v1.MapPost("/provider-events/mock-sms", async (HttpContext http, IConfiguration config, ProviderEventProcessor processor, ILogger<ProviderEventProcessor> log) =>
        {
            // The cap is enforced before and while buffering: a declared length over the cap is refused outright,
            // the server limit is lowered for this request, and the read itself stops at cap + 1 bytes.
            if (http.Request.ContentLength > MaxBodyBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            var limit = http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = MaxBodyBytes;

            using var ms = new MemoryStream();
            var buffer = new byte[8192];
            try
            {
                int n;
                while ((n = await http.Request.Body.ReadAsync(buffer, http.RequestAborted)) > 0)
                {
                    if (ms.Length + n > MaxBodyBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                    ms.Write(buffer, 0, n);
                }
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            }
            var body = ms.ToArray();

            // No key configured = nothing can be verified = nothing is accepted.
            if (!MockSignature.Verify(config["Providers:MockSms:SigningKey"], body, http.Request.Headers[MockSignature.HeaderName].ToString()))
                return ApiResults.Error("INVALID_SIGNATURE", StatusCodes.Status401Unauthorized);

            ProviderEvent evt;
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                string? S(string n) => root.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var id = S("providerEventId"); var type = S("type");
                if (string.IsNullOrWhiteSpace(id) || id.Length > 150 || string.IsNullOrWhiteSpace(type) || type.Length > 100)
                    return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest);
                DateTimeOffset? occurred = DateTimeOffset.TryParse(S("occurredAt"), out var o) ? o : null;
                Guid? tenant = Guid.TryParse(S("tenantId"), out var t) ? t : null;
                evt = new ProviderEvent(id, S("providerMessageId"), type, occurred, tenant);
            }
            catch (JsonException) { return ApiResults.Error("VALIDATION_FAILED", StatusCodes.Status400BadRequest); }

            var outcome = await processor.ProcessAsync(evt, http.RequestAborted);
            if (outcome == EventOutcome.NoTenant)
            {
                log.LogWarning("Provider event {EventId} matched no message and carried no tenant; not stored", evt.ProviderEventId);
                return ApiResults.Error("UNATTRIBUTABLE", StatusCodes.Status422UnprocessableEntity);
            }
            return Results.Ok(new { status = outcome.ToString().ToLowerInvariant() });
        }).AllowAnonymous();
    }
}
