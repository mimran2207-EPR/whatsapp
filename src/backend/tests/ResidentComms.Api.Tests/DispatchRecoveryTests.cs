using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ResidentComms.Infrastructure.Events;
using ResidentComms.Infrastructure.Sql;
using ResidentComms.TestShared;
using ResidentComms.Worker.Dispatch;
using ResidentComms.Worker.Providers;

namespace ResidentComms.Api.Tests;

/// <summary>Fix round 1: crash recovery, shutdown safety, leases, unique provider ids, body cap, retry rules.</summary>
public class DispatchRecoveryTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly object Mapping = new
    {
        idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה",
        variableColumns = new[] { "שם ילד", "גן" },
    };

    private sealed class FuncAdapter(Func<SmsSendRequest, Task<SendOutcome>> send) : ISmsAdapter
    {
        public List<SmsSendRequest> Calls { get; } = [];
        public Task<SendOutcome> SendAsync(SmsSendRequest r, CancellationToken ct) { lock (Calls) Calls.Add(r); return send(r); }
    }

    private static SendOutcome Accept() => new(SendOutcome.Accepted, "pm-" + Guid.NewGuid().ToString("N"), null);

    private OutboxDispatcher Dispatcher(ISmsAdapter a) =>
        new(f.Services.GetRequiredService<SqlConnectionFactory>(), a, NullLogger<OutboxDispatcher>.Instance);

    private async Task<(Guid Camp, Guid Message)> Released(string tag)
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", Mapping);
        var camp = await dana.CreateCampaign("recovery-" + tag);
        await dana.PatchDraft(camp, new
        {
            audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = $"שלום {{שם הורה}}, עבור {{שם ילד}} ({tag})",
            fieldDefaults = new Dictionary<string, string> { ["שם ילד"] = "ילדכם" },
        });
        await meir.Approve(camp, await dana.Submit(camp));
        await meir.Release(camp);
        return (camp, await f.Db.ScalarAsync<Guid>($"SELECT TOP 1 message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY message_id"));
    }

    [Fact] public async Task Open_attempt_with_expired_lease_is_recovered_as_unknown_without_resend()
    {
        var (camp, id) = await Released("recover");
        // A worker died after phase A: HANDED_OFF, open attempt, unprocessed outbox row, expired lease.
        await f.Db.ExecAsync($@"
            UPDATE Message SET processing_state = 'IN_PROGRESS', handoff_state = 'HANDED_OFF' WHERE message_id = '{id}';
            INSERT SendAttempt(attempt_id, tenant_id, message_id, attempt_number, attempt_reason, request_started_at)
              VALUES (NEWID(), '{ApiFactory.DevTenant}', '{id}', 1, 'INITIAL', SYSUTCDATETIME());
            UPDATE OutboxMessage SET locked_until = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE aggregate_id = '{id}';");
        var adapter = new FuncAdapter(_ => Task.FromResult(Accept()));

        await Dispatcher(adapter).RunOnceAsync(CancellationToken.None);

        Assert.DoesNotContain(adapter.Calls, c => c.MessageId == id);
        Assert.Equal("UNKNOWN", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}' AND attempt_outcome = 'AMBIGUOUS' AND acceptance_ambiguous = 1"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND processed_at IS NOT NULL"));

        var rina = await f.LoginAs("rina");
        var j = await (await rina.GetAsync($"/v1/campaigns/{camp}/tracking")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(j.GetProperty("exceptions").EnumerateArray(),
            e => e.GetProperty("messageId").GetGuid() == id && e.GetProperty("displayLabelHe").GetString() == "לא ידוע");
    }

    [Fact] public async Task Provider_answer_is_recorded_even_when_shutdown_is_requested_during_the_call()
    {
        var (_, id) = await Released("shutdown");
        using var cts = new CancellationTokenSource();
        var adapter = new FuncAdapter(r => { if (r.MessageId == id) cts.Cancel(); return Task.FromResult(Accept()); });
        try { await Dispatcher(adapter).RunOnceAsync(cts.Token); } catch (OperationCanceledException) { }

        Assert.Equal("ACCEPTED", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND processed_at IS NOT NULL"));
    }

    [Fact] public async Task Phase_b_does_not_overwrite_a_decision_recovery_already_made()
    {
        var (_, id) = await Released("no-overwrite");
        var adapter = new FuncAdapter(async r =>
        {
            if (r.MessageId == id) // simulate a second worker that recovered this attempt while the call was slow
                await f.Db.ExecAsync($@"
                    UPDATE SendAttempt SET attempt_outcome = 'AMBIGUOUS', acceptance_ambiguous = 1 WHERE message_id = '{id}';
                    UPDATE Message SET handoff_state = 'UNKNOWN' WHERE message_id = '{id}';
                    UPDATE OutboxMessage SET processed_at = SYSUTCDATETIME() WHERE aggregate_id = '{id}';");
            return Accept();
        });
        await Dispatcher(adapter).RunOnceAsync(CancellationToken.None);

        Assert.Equal("UNKNOWN", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal("AMBIGUOUS", await f.Db.ScalarAsync<string>($"SELECT attempt_outcome FROM SendAttempt WHERE message_id = '{id}'"));
        Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM Message WHERE message_id = '{id}' AND provider_message_id IS NOT NULL"));
    }

    [Fact] public async Task Each_row_gets_a_long_lease_while_its_request_is_in_flight()
    {
        var (_, id) = await Released("lease");
        double? leaseSeconds = null;
        var adapter = new FuncAdapter(async r =>
        {
            if (r.MessageId == id)
                leaseSeconds = await f.Db.ScalarAsync<int>($"SELECT DATEDIFF(second, SYSUTCDATETIME(), locked_until) FROM OutboxMessage WHERE aggregate_id = '{id}'");
            return Accept();
        });
        await Dispatcher(adapter).RunOnceAsync(CancellationToken.None);
        Assert.True(leaseSeconds > 100, $"lease was {leaseSeconds}s");
    }

    [Fact] public async Task Provider_message_id_is_unique_per_provider()
    {
        var (camp, _) = await Released("unique-pm");
        var ids = new List<Guid>();
        for (var i = 0; i < 2; i++) ids.Add(await f.Db.ScalarAsync<Guid>($"SELECT message_id FROM Message WHERE campaign_id = '{camp}' ORDER BY message_id OFFSET {i} ROWS FETCH NEXT 1 ROWS ONLY"));
        await f.Db.ExecAsync($"UPDATE Message SET provider_id = 'mock-sms', provider_message_id = 'dup-pm' WHERE message_id = '{ids[0]}'");
        await Assert.ThrowsAsync<SqlException>(() => f.Db.ExecAsync($"UPDATE Message SET provider_id = 'mock-sms', provider_message_id = 'dup-pm' WHERE message_id = '{ids[1]}'"));
    }

    private sealed class CountingContent(int chunks, int chunkSize) : HttpContent
    {
        public int Written;
        protected override async Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context)
        {
            var buf = new byte[chunkSize];
            for (var i = 0; i < chunks; i++) { await stream.WriteAsync(buf); Interlocked.Increment(ref Written); }
        }
        protected override bool TryComputeLength(out long length) { length = -1; return false; } // chunked: no Content-Length
    }

    [Fact] public async Task Oversized_event_body_is_refused_with_413_before_it_is_buffered()
    {
        var content = new CountingContent(chunks: 200, chunkSize: 64 * 1024); // 12.5 MB
        var req = new HttpRequestMessage(HttpMethod.Post, "/v1/provider-events/mock-sms") { Content = content };
        req.Headers.Add(MockSignature.HeaderName, "00");
        HttpStatusCode? status = null;
        try { status = (await f.CreateClient().SendAsync(req)).StatusCode; } catch (Exception) { /* server may abort the upload */ }

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, status); // (TestServer buffers the client upload itself, so "not consumed" is not observable in-process)
        var declared = new HttpRequestMessage(HttpMethod.Post, "/v1/provider-events/mock-sms") { Content = new ByteArrayContent(new byte[64 * 1024 + 1]) };
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await f.CreateClient().SendAsync(declared)).StatusCode);
    }

    [Fact] public async Task Local_failure_retry_sends_the_same_idempotency_key_and_fifth_failure_is_rejected_before_send()
    {
        var (_, id) = await Released("retry");
        var adapter = new FuncAdapter(r => throw new HttpRequestException("down"));
        var d = Dispatcher(adapter);
        var keys = new List<string>();
        for (var round = 1; round <= 5; round++)
        {
            await f.Db.ExecAsync($"UPDATE OutboxMessage SET available_at = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE aggregate_id = '{id}' AND processed_at IS NULL");
            await d.RunOnceAsync(CancellationToken.None);
            if (round < 5)
            {
                Assert.Equal(0, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND processed_at IS NOT NULL"));
                Assert.Equal("NOT_HANDED_OFF", await f.Db.ScalarAsync<string>($"SELECT handoff_state FROM Message WHERE message_id = '{id}'"));
            }
        }
        keys.AddRange(adapter.Calls.Where(c => c.MessageId == id).Select(c => c.IdempotencyKey));
        Assert.Equal(5, keys.Count);
        Assert.Single(keys.Distinct());
        Assert.Equal(5, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}'"));
        Assert.Equal(4, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM SendAttempt WHERE message_id = '{id}' AND attempt_reason = 'CONTROLLED_RETRY'"));
        Assert.Equal("REJECTED_BEFORE_SEND", await f.Db.ScalarAsync<string>($"SELECT processing_state FROM Message WHERE message_id = '{id}'"));
        Assert.Equal(1, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage WHERE aggregate_id = '{id}' AND processed_at IS NOT NULL"));

        // no further retries
        await d.RunOnceAsync(CancellationToken.None);
        Assert.Equal(5, adapter.Calls.Count(c => c.MessageId == id));
    }
}
