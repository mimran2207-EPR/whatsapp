using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ResidentComms.Infrastructure.Events;
using ResidentComms.Infrastructure.Sql;
using ResidentComms.TestShared;
using ResidentComms.Worker.Dispatch;
using ResidentComms.Worker.Providers;

namespace ResidentComms.Api.Tests;

public class DispatchAndEventsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה",
        variableColumns = new[] { "שם ילד", "גן" },
    };

    private sealed class NullPoster : IProviderEventPoster
    {
        public Task PostAsync(string body, string signatureHex, CancellationToken ct) => Task.CompletedTask;
    }

    private OutboxDispatcher Dispatcher(MockSmsOptions o, IProviderEventPoster? poster = null) =>
        new(f.Services.GetRequiredService<SqlConnectionFactory>(), new MockSmsAdapter(o, poster ?? new NullPoster()), NullLogger<OutboxDispatcher>.Instance);

    private static MockSmsOptions Options(int seed = 1) => new()
    {
        AcceptRate = 1, RejectRate = 0, TimeoutRate = 0, DeliverRate = 1, FailRate = 0, DuplicateEventRate = 0,
        MaxEventDelaySeconds = 0, Seed = seed, SigningKey = ApiFactory.TestMockSmsKey,
    };

    private async Task<Guid> ReleasedCampaign(string tag)
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var camp = await dana.CreateCampaign("dispatch-" + tag);
        await dana.PatchDraft(camp, new
        {
            audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = $"שלום {{שם הורה}}, עבור {{שם ילד}} ({tag})",
            fieldDefaults = new Dictionary<string, string> { ["שם ילד"] = "ילדכם" },
        });
        await meir.Approve(camp, await dana.Submit(camp));
        await meir.Release(camp);
        return camp;
    }

    /// <summary>Releases a campaign and puts one of its messages in the "accepted by provider" state with a known provider id.</summary>
    private async Task<(Guid MessageId, string ProviderMessageId)> AcceptedMessage(string tag)
    {
        var camp = await ReleasedCampaign(tag);
        var id = await f.Db.ScalarAsync<Guid>($"SELECT TOP 1 message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY message_id");
        var pm = "pm-" + Guid.NewGuid().ToString("N");
        await f.Db.ExecAsync($"UPDATE Message SET processing_state = 'IN_PROGRESS', handoff_state = 'ACCEPTED', provider_id = 'mock-sms', provider_message_id = '{pm}' WHERE message_id = '{id}'");
        return (id, pm);
    }

    private static (string Body, string Signature) Signed(object payload, string key = ApiFactory.TestMockSmsKey)
    {
        var body = JsonSerializer.Serialize(payload);
        return (body, MockSignature.Compute(key, Encoding.UTF8.GetBytes(body)));
    }

    private static async Task<HttpResponseMessage> Post(HttpClient c, string body, string? signature)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/v1/provider-events/mock-sms") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        if (signature is not null) req.Headers.Add(MockSignature.HeaderName, signature);
        return await c.SendAsync(req);
    }

    private async Task<HttpResponseMessage> Event(string pm, string type, string? eventId = null, string? tenant = null)
    {
        var (body, sig) = Signed(new { providerEventId = eventId ?? $"{pm}:{type}", providerMessageId = pm, type, occurredAt = DateTimeOffset.UtcNow, tenantId = tenant });
        return await Post(f.CreateClient(), body, sig);
    }

    private Task<string> Delivery(Guid id) => f.Db.ScalarAsync<string>($"SELECT delivery_state FROM Message WHERE message_id = '{id}'");

    [Fact] public async Task Timeout_marks_unknown_and_is_never_retried_automatically()
    {
        // adapter forced AMBIGUOUS for one message → handoff UNKNOWN, acceptance_ambiguous=1, OutboxMessage.processed_at set, SendAttempt count = 1 after running the dispatcher 3 more cycles
        var camp = await ReleasedCampaign("timeout");
        var id = await f.Db.ScalarAsync<Guid>($"SELECT TOP 1 message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY message_id");
        var options = Options();
        options.ForcedOutcomes[id] = SendOutcome.Ambiguous;
        var dispatcher = Dispatcher(options);

        Assert.True(await dispatcher.RunOnceAsync(CancellationToken.None) > 0);
        for (var i = 0; i < 3; i++) await dispatcher.RunOnceAsync(CancellationToken.None);

        Assert.Equal("UNKNOWN", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}' AND acceptance_ambiguous = 1 AND attempt_outcome = 'AMBIGUOUS'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND processed_at IS NOT NULL"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}'"));
        // the other messages of the campaign were accepted
        Assert.True(await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND handoff_state = 'ACCEPTED' AND provider_message_id IS NOT NULL") > 0);
    }

    [Fact] public async Task Late_sent_after_delivered_does_not_lower_state()
    {
        // post delivered then sent → delivery_state stays DELIVERED
        var (id, pm) = await AcceptedMessage("late-sent");
        Assert.Equal(HttpStatusCode.OK, (await Event(pm, "delivered")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Event(pm, "sent")).StatusCode);
        Assert.Equal("DELIVERED", await Delivery(id));
        Assert.Equal(2, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageEvent WHERE message_id = '{id}'"));
    }

    [Fact] public async Task Duplicate_event_creates_one_fact()
    {
        // post the same providerEventId twice → one MessageEvent row
        var (id, pm) = await AcceptedMessage("duplicate");
        var first = await Event(pm, "sent", "evt-dup-1");
        var second = await Event(pm, "sent", "evt-dup-1");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("duplicate", (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageEvent WHERE message_id = '{id}'"));
        Assert.Equal("SENT_PER_PROVIDER", await Delivery(id));
    }

    [Fact] public async Task Delivered_then_failed_is_sticky_conflict()
    {
        // → delivery_state UNKNOWN, delivery_conflict=1; then a later delivered keeps UNKNOWN
        var (id, pm) = await AcceptedMessage("conflict");
        await Event(pm, "delivered");
        await Event(pm, "failed");
        Assert.Equal("UNKNOWN", await Delivery(id));
        Assert.True(await f.Db.ScalarAsync<bool>($"SELECT delivery_conflict FROM Message WHERE message_id = '{id}'"));
        Assert.Equal("CONFLICTING", await f.Db.ScalarAsync<string>($"SELECT data_quality FROM Message WHERE message_id = '{id}'"));

        await Event(pm, "delivered", "evt-later-delivered");
        Assert.Equal("UNKNOWN", await Delivery(id));
        Assert.True(await f.Db.ScalarAsync<bool>($"SELECT delivery_conflict FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(3, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageEvent WHERE message_id = '{id}'")); // every raw event is kept
    }

    [Fact] public async Task Bad_signature_is_rejected_and_not_stored()
    {
        // 401, no MessageEvent row
        var (id, pm) = await AcceptedMessage("bad-sig");
        var body = JsonSerializer.Serialize(new { providerEventId = "evt-bad-sig", providerMessageId = pm, type = "delivered" });
        var wrongKey = MockSignature.Compute("some-other-key-0123456789-0123456789-0123", Encoding.UTF8.GetBytes(body));

        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(f.CreateClient(), body, wrongKey)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(f.CreateClient(), body, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(f.CreateClient(), body, "not-hex")).StatusCode);
        Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageEvent WHERE deduplication_key = 'mock:evt-bad-sig'"));
        Assert.Equal("NOT_REPORTED", await Delivery(id));
    }

    [Fact] public async Task Tracking_matches_truth_book_counts()
    {
        var (camp, rina) = await SeedTruthBook("truth-book-01", withUnknownAndRejected: false);
        await AssertTruthBook(camp, rina, messages: 5, delivered: 2, failed: 1, unknown: 1, sentOrNotReported: 1, accepted: 5, exceptions: 2);
    }

    [Fact] public async Task Tracking_matches_truth_book_counts_with_unknown_and_rejected_rows_present()
    {
        // Same truth book plus one handoff-UNKNOWN message (timeout) and one provider-REJECTED message: they belong to the
        // unknown / failed buckets, exactly as the campaign list counts them, and never to sentOrNotReported.
        var (camp, rina) = await SeedTruthBook("truth-book-01-extra", withUnknownAndRejected: true);
        await AssertTruthBook(camp, rina, messages: 7, delivered: 2, failed: 2, unknown: 2, sentOrNotReported: 1, accepted: 5, exceptions: 4);
        var list = (await rina.GetFromJsonAsync<JsonElement>("/v1/campaigns")).EnumerateArray().Single(c => c.GetProperty("campaignId").GetGuid() == camp).GetProperty("counts");
        Assert.Equal(2, list.GetProperty("delivered").GetInt32());
        Assert.Equal(2, list.GetProperty("failed").GetInt32());
        Assert.Equal(2, list.GetProperty("unknown").GetInt32());
    }

    [Fact] public async Task Tracking_banner_and_list_agree_for_timeouts_rejection_delivered_and_failed_through_the_real_dispatcher()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir"); var rina = await f.LoginAs("rina");
        var csv = "ת.ז,שם הורה,טל נייד הורה,שם ילד,גן\r\n" + string.Concat(Enumerable.Range(1, 6).Select(i => $"30200000{i},הורה {i},052222000{i},ילד,גן\r\n"));
        var imp = await dana.UploadImport(new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "buckets.csv", Mapping);
        var camp = await dana.CreateCampaign("buckets");
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = "שלום {שם הורה} (buckets)", fieldDefaults = new Dictionary<string, string>() });
        await meir.Approve(camp, await dana.Submit(camp));
        Assert.Equal(6, (await meir.Release(camp)).MessagesCreated);

        var ids = new List<Guid>();
        for (var i = 0; i < 6; i++) ids.Add(await f.Db.ScalarAsync<Guid>($"SELECT message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY destination_value OFFSET {i} ROWS FETCH NEXT 1 ROWS ONLY"));
        var options = Options();
        foreach (var id in ids.Take(3)) options.ForcedOutcomes[id] = SendOutcome.Ambiguous;   // 3 timeouts
        options.ForcedOutcomes[ids[3]] = SendOutcome.Rejected;                              // 1 rejected by the provider
        await Dispatcher(options).RunOnceAsync(CancellationToken.None);                      // ids[4], ids[5] accepted

        // delivered / failed arrive as signed provider events (the real events path); the clock is moved so event time is recognisable
        var pm4 = await f.Db.ScalarAsync<string>($"SELECT provider_message_id FROM Message WHERE message_id = '{ids[4]}'");
        var pm5 = await f.Db.ScalarAsync<string>($"SELECT provider_message_id FROM Message WHERE message_id = '{ids[5]}'");
        var before = f.Clock.Now;
        f.Clock.Now = before.AddMinutes(7);
        try
        {
            Assert.Equal(HttpStatusCode.OK, (await Event(pm4, "delivered")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await Event(pm5, "failed")).StatusCode);
        }
        finally { f.Clock.Now = before; }

        var j = await rina.GetFromJsonAsync<JsonElement>($"/v1/campaigns/{camp}/tracking");
        var d = j.GetProperty("delivery");
        Assert.Equal(6, j.GetProperty("messages").GetInt32());
        Assert.Equal(1, d.GetProperty("delivered").GetInt32());
        Assert.Equal(2, d.GetProperty("failed").GetInt32());            // failed delivery + provider rejection
        Assert.Equal(3, d.GetProperty("unknown").GetInt32());           // the three timeouts
        Assert.Equal(0, d.GetProperty("sentOrNotReported").GetInt32());
        Assert.Equal(2, j.GetProperty("handoff").GetProperty("accepted").GetInt32());
        Assert.Equal(1, j.GetProperty("handoff").GetProperty("rejected").GetInt32());
        Assert.Equal(3, j.GetProperty("handoff").GetProperty("unknown").GetInt32());
        Assert.Equal(5, j.GetProperty("exceptions").GetArrayLength()); // 3 unknown + 1 rejected + 1 failed

        var list = (await rina.GetFromJsonAsync<JsonElement>("/v1/campaigns")).EnumerateArray().Single(c => c.GetProperty("campaignId").GetGuid() == camp).GetProperty("counts");
        Assert.Equal(d.GetProperty("delivered").GetInt32(), list.GetProperty("delivered").GetInt32());
        Assert.Equal(d.GetProperty("failed").GetInt32(), list.GetProperty("failed").GetInt32());
        Assert.Equal(d.GetProperty("unknown").GetInt32(), list.GetProperty("unknown").GetInt32());

        // dataAsOf is the latest event time, not "now"
        var latest = await f.Db.ScalarAsync<DateTime>($"SELECT MAX(e.received_at) FROM MessageEvent e JOIN Message m ON m.message_id = e.message_id WHERE m.campaign_id = '{camp}'");
        Assert.Equal(DateTime.SpecifyKind(latest, DateTimeKind.Utc), j.GetProperty("dataAsOf").GetDateTimeOffset().UtcDateTime);
        Assert.NotEqual(before, j.GetProperty("dataAsOf").GetDateTimeOffset());
    }

    private async Task<(Guid Camp, HttpClient Rina)> SeedTruthBook(string name, bool withUnknownAndRejected)
    {
        // Seed 5 messages for 3 recipients exactly as docs/qa/truth-book-01.md (states set directly via SQL),
        // then GET tracking → messages 5, delivered 2, failed 1, unknown 1, sentOrNotReported 1,
        // operationalDeliveryRate numerator 2 / denominator 5 (all handed off).
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir"); var rina = await f.LoginAs("rina");
        var csv = "ת.ז,שם הורה,טל נייד הורה,שם ילד,גן\r\n"
                + "301000001,דנה כהן,0521110001,נועה,תפוח\r\n"
                + "301000002,רונית לוי,0521110002,איתי,דובדבן\r\n"
                + "301000003,יעל בר,0521110012,מאיה,תפוח\r\n";
        var imp = await dana.UploadImport(new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "truth.csv", Mapping);
        var camp = await dana.CreateCampaign(name);
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = $"שלום {{שם הורה}} (truth {name})", fieldDefaults = new Dictionary<string, string>() });
        await meir.Approve(camp, await dana.Submit(camp));
        Assert.Equal(3, (await meir.Release(camp)).MessagesCreated);

        // Existing three SMS messages are M2 (R1), M4 (R2), M5 (R3); M1 (WHATSAPP) and M3 (EMAIL) are added for R1.
        var ids = new List<Guid>();
        for (var i = 0; i < 3; i++) ids.Add(await f.Db.ScalarAsync<Guid>($"SELECT message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY destination_value OFFSET {i} ROWS FETCH NEXT 1 ROWS ONLY"));
        var (m2, m4, m5) = (ids[0], ids[1], ids[2]);
        await f.Db.ExecAsync($@"
            UPDATE Message SET processing_state = 'IN_PROGRESS', handoff_state = 'ACCEPTED' WHERE campaign_id = '{camp}';
            UPDATE Message SET delivery_state = 'DELIVERED' WHERE message_id = '{m2}';
            UPDATE Message SET delivery_state = 'FAILED' WHERE message_id = '{m4}';
            UPDATE Message SET delivery_state = 'UNKNOWN' WHERE message_id = '{m5}';
            INSERT Message(message_id, tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no, idempotency_key, destination_value,
                           processing_state, handoff_state, delivery_state, data_quality)
            SELECT NEWID(), tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, c.channel, 1, 'truth-' + CONVERT(VARCHAR(36), NEWID()), destination_value,
                   'IN_PROGRESS', 'ACCEPTED', c.state, 'CURRENT'
            FROM Message CROSS JOIN (VALUES ('WHATSAPP', 'DELIVERED'), ('EMAIL', 'NOT_REPORTED')) AS c(channel, state)
            WHERE message_id = '{m2}';");
        if (withUnknownAndRejected)
            await f.Db.ExecAsync($@"
                INSERT Message(message_id, tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no, idempotency_key, destination_value,
                               processing_state, handoff_state, delivery_state, data_quality)
                SELECT NEWID(), tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, 'SMS', c.seq, 'truth-' + CONVERT(VARCHAR(36), NEWID()), destination_value,
                       'IN_PROGRESS', c.handoff, 'NOT_REPORTED', 'CURRENT'
                FROM Message CROSS JOIN (VALUES (2, 'UNKNOWN'), (3, 'REJECTED')) AS c(seq, handoff)
                WHERE message_id = '{m5}';");
        return (camp, rina);
    }

    private async Task AssertTruthBook(Guid camp, HttpClient rina, int messages, int delivered, int failed, int unknown, int sentOrNotReported, int accepted, int exceptions)
    {
        var r = await rina.GetAsync($"/v1/campaigns/{camp}/tracking");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("sandbox-mock", j.GetProperty("environment").GetString());
        Assert.Equal(messages, j.GetProperty("messages").GetInt32());
        var d = j.GetProperty("delivery");
        Assert.Equal(delivered, d.GetProperty("delivered").GetInt32());
        Assert.Equal(failed, d.GetProperty("failed").GetInt32());
        Assert.Equal(unknown, d.GetProperty("unknown").GetInt32());
        Assert.Equal(sentOrNotReported, d.GetProperty("sentOrNotReported").GetInt32());
        Assert.Equal(accepted, j.GetProperty("handoff").GetProperty("accepted").GetInt32());
        var rate = j.GetProperty("kpis").EnumerateArray().Single(k => k.GetProperty("key").GetString() == "operationalDeliveryRate");
        Assert.Equal(2, rate.GetProperty("numerator").GetInt32());
        Assert.Equal(messages, rate.GetProperty("denominator").GetInt32());
        Assert.Equal(Math.Round(2m / messages, 4), rate.GetProperty("value").GetDecimal());
        Assert.Equal("5 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.", j.GetProperty("bannerHe").GetString());

        var ex = j.GetProperty("exceptions").EnumerateArray().ToList();
        Assert.Equal(exceptions, ex.Count);
        Assert.Contains(ex, e => e.GetProperty("displayStatus").GetString() == "Failed" && e.GetProperty("displayLabelHe").GetString() == "נכשל");
        Assert.Contains(ex, e => e.GetProperty("displayStatus").GetString() == "Unknown" && e.GetProperty("displayLabelHe").GetString() == "לא ידוע");
        Assert.All(ex, e => Assert.Matches(@"^\d{3}-\*\*\*-\*\*\d{2}$", e.GetProperty("recipientMasked").GetString()!));

        // another tenant cannot see it
        var other = f.ClientWith("x", "analyst", Guid.NewGuid(), "EDU");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/v1/campaigns/{camp}/tracking")).StatusCode);
    }

    [Fact] public async Task Read_event_sets_read_at_without_touching_delivery_and_unattributed_read_is_kept()
    {
        var (id, pm) = await AcceptedMessage("read");
        await Event(pm, "delivered");
        Assert.Equal(HttpStatusCode.OK, (await Event(pm, "read")).StatusCode);
        Assert.Equal("DELIVERED", await Delivery(id));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE message_id = '{id}' AND read_at IS NOT NULL"));

        var orphan = await Event("pm-nobody", "read", "evt-orphan", tenant: ApiFactory.DevTenant.ToString());
        Assert.Equal(HttpStatusCode.OK, orphan.StatusCode);
        Assert.Equal(1, await f.Db.ScalarAsync<int>("SELECT COUNT(*) FROM MessageEvent WHERE deduplication_key = 'mock:evt-orphan' AND message_id IS NULL AND correlation_quality = 'UNATTRIBUTED'"));
    }

    [Fact] public async Task Transient_local_failure_is_retried_with_backoff_not_marked_handed_off()
    {
        var camp = await ReleasedCampaign("local-failure");
        var id = await f.Db.ScalarAsync<Guid>($"SELECT TOP 1 message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY message_id");
        var options = Options();
        options.ForcedOutcomes[id] = "LOCAL_FAILURE";
        await Dispatcher(options).RunOnceAsync(CancellationToken.None);

        Assert.Equal("NOT_HANDED_OFF", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND attempts = 1 AND processed_at IS NULL AND available_at > SYSUTCDATETIME()"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}' AND attempt_outcome = 'LOCAL_FAILURE'"));
    }

    [Fact] public async Task Mock_provider_events_flow_through_the_signed_endpoint_end_to_end()
    {
        var camp = await ReleasedCampaign("e2e");
        var options = Options(seed: 7);
        options.MaxEventDelaySeconds = 1; options.DuplicateEventRate = 1; // every event is posted twice
        var dispatcher = Dispatcher(options, new HttpProviderEventPoster(f.CreateClient()));
        await dispatcher.RunOnceAsync(CancellationToken.None);

        var expected = await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'");
        for (var i = 0; i < 100; i++)
        {
            if (await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND delivery_state = 'DELIVERED'") == expected) break;
            await Task.Delay(200);
        }
        Assert.Equal(expected, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND delivery_state = 'DELIVERED'"));
        Assert.Equal(expected * 2, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM MessageEvent e JOIN Message m ON m.message_id = e.message_id WHERE m.campaign_id = '{camp}'")); // sent + delivered, duplicates deduplicated
    }

    private sealed class FlakyPoster(int failures) : IProviderEventPoster
    {
        public int Calls;
        public readonly List<string> Delivered = [];
        public Task PostAsync(string body, string signatureHex, CancellationToken ct)
        {
            if (Interlocked.Increment(ref Calls) <= failures) throw new HttpRequestException("422 UNATTRIBUTABLE (event raced the provider id commit)", null, HttpStatusCode.UnprocessableEntity);
            lock (Delivered) Delivered.Add(body);
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Root cause of lost delivery facts: an event that reaches the API before the dispatcher has committed provider_message_id
    /// is refused (422, no tenant to attribute it to) and the mock provider never re-sent it. A real provider retries webhooks.
    /// </summary>
    [Fact] public async Task Mock_provider_retries_an_event_the_api_refused()
    {
        var poster = new FlakyPoster(failures: 2);
        var o = Options(seed: 3);
        o.WebhookRetryDelaysMs = [20, 20, 20];
        var adapter = new MockSmsAdapter(o, poster);
        var outcome = await adapter.SendAsync(new SmsSendRequest(Guid.NewGuid(), "+972521234567", "x", "k"), CancellationToken.None);
        Assert.Equal(SendOutcome.Accepted, outcome.Kind);

        for (var i = 0; i < 100 && poster.Delivered.Count < 2; i++) await Task.Delay(50);
        Assert.Equal(2, poster.Delivered.Count); // sent + delivered both landed despite two refusals
        Assert.Contains(poster.Delivered, b => b.Contains("\"delivered\""));
    }

    /// <summary>The terminal event is posted for every accepted message whenever DeliverRate + FailRate = 1 (no "stays sent" bucket).</summary>
    [Fact] public async Task Released_campaign_reaches_a_terminal_delivery_state_through_the_api_with_racing_events()
    {
        var camp = await ReleasedCampaign("race");
        var options = Options(seed: 11);
        options.MaxEventDelaySeconds = 0; // events race the dispatcher commit; retries must recover them
        options.WebhookRetryDelaysMs = [200, 400, 800, 1600];
        var dispatcher = Dispatcher(options, new HttpProviderEventPoster(f.CreateClient()));
        await dispatcher.RunOnceAsync(CancellationToken.None);

        var expected = await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}'");
        for (var i = 0; i < 100; i++)
        {
            if (await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND delivery_state = 'DELIVERED'") == expected) break;
            await Task.Delay(100);
        }
        Assert.Equal(expected, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE campaign_id = '{camp}' AND delivery_state = 'DELIVERED'"));
    }

    private sealed class StatusPoster(HttpStatusCode? status) : IProviderEventPoster
    {
        public int Calls;
        public Task PostAsync(string body, string signatureHex, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            throw new HttpRequestException("refused", null, status);
        }
    }

    private async Task<int> CallsAfterAccept(StatusPoster poster)
    {
        var o = Options(seed: 5);
        o.DeliverRate = 1; o.WebhookRetryDelaysMs = [30, 30, 30];
        using var adapter = new MockSmsAdapter(o, poster);
        await adapter.SendAsync(new SmsSendRequest(Guid.NewGuid(), "+972521234567", "x", "k"), CancellationToken.None);
        await Task.Delay(1500);
        return poster.Calls;
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task Mock_provider_does_not_retry_a_definite_client_error(HttpStatusCode status)
        => Assert.Equal(2, await CallsAfterAccept(new StatusPoster(status))); // sent + delivered, one attempt each

    [Fact] public async Task Mock_provider_retries_422_and_transport_failures_up_to_the_schedule()
    {
        Assert.Equal(2 * 4, await CallsAfterAccept(new StatusPoster(HttpStatusCode.UnprocessableEntity)));
        Assert.Equal(2 * 4, await CallsAfterAccept(new StatusPoster(null)));
    }

    [Fact] public async Task Mock_provider_stops_redelivering_when_it_is_shut_down()
    {
        var p = new StatusPoster(HttpStatusCode.UnprocessableEntity);
        var o = Options(seed: 6);
        o.DeliverRate = 1; o.WebhookRetryDelaysMs = [400, 400, 400, 400];
        var adapter = new MockSmsAdapter(o, p);
        await adapter.SendAsync(new SmsSendRequest(Guid.NewGuid(), "+972521234567", "x", "k"), CancellationToken.None);
        await Task.Delay(700); // first attempts made, waiting to retry
        var before = p.Calls;
        adapter.Dispose();
        await Task.Delay(1500);
        Assert.Equal(before, p.Calls);
    }
}
