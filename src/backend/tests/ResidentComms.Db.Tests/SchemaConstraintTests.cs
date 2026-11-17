using System.Data;
using Microsoft.Data.SqlClient;

namespace ResidentComms.Db.Tests;

public class SchemaConstraintTests(TestDatabase db) : IClassFixture<TestDatabase>
{
    // Seed: one tenant, campaign, revision, snapshot, recipient. Returns ids.
    private async Task<(Guid tenant, Guid campaign, Guid revision, Guid recipient)> SeedAsync()
    {
        Guid t = Guid.NewGuid(), aud = Guid.NewGuid(), av = Guid.NewGuid(), snap = Guid.NewGuid(),
             c = Guid.NewGuid(), r = Guid.NewGuid(), cr = Guid.NewGuid();
        await db.Exec($"""
            INSERT Tenant(tenant_id, name) VALUES ('{t}', N'מועצה בדיונית');
            INSERT Audience(audience_id, tenant_id, name, audience_kind) VALUES ('{aud}', '{t}', N'הורי גן', 'FILE');
            INSERT AudienceVersion(audience_version_id, tenant_id, audience_id, version_no) VALUES ('{av}', '{t}', '{aud}', 1);
            INSERT AudienceSnapshot(audience_snapshot_id, tenant_id, audience_version_id, frozen_at) VALUES ('{snap}', '{t}', '{av}', SYSUTCDATETIME());
            INSERT Campaign(campaign_id, tenant_id, department_id, campaign_name, campaign_type, communication_purpose, campaign_state, created_by)
              VALUES ('{c}', '{t}', 'EDU', N'משלוח ניסיון', 'MANUAL', 'SERVICE', 'DRAFT', 'user-1');
            INSERT CampaignRevision(campaign_revision_id, tenant_id, campaign_id, revision_no, audience_snapshot_id)
              VALUES ('{r}', '{t}', '{c}', 1, '{snap}');
            INSERT CampaignRecipient(campaign_recipient_id, tenant_id, campaign_id, audience_snapshot_id, source_recipient_id, approved_identity_key)
              VALUES ('{cr}', '{t}', '{c}', '{snap}', '000123', 'ID:000123');
            """);
        return (t, c, r, cr);
    }

    private Task InsertMessage(Guid t, Guid c, Guid r, Guid cr, string channel, int seq, string key) => db.Exec($"""
        INSERT Message(message_id, tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no,
                       idempotency_key, destination_value, processing_state, handoff_state, delivery_state, data_quality)
        VALUES (NEWID(), '{t}', '{c}', '{r}', '{cr}', '{channel}', {seq}, '{key}', '+972500000001', 'PENDING', 'NOT_HANDED_OFF', 'NOT_REPORTED', 'CURRENT');
        """);

    [Fact]
    public async Task Duplicate_logical_message_is_rejected()
    {
        var (t, c, r, cr) = await SeedAsync();
        await InsertMessage(t, c, r, cr, "SMS", 1, $"k-{Guid.NewGuid()}");
        await Assert.ThrowsAsync<SqlException>(() => InsertMessage(t, c, r, cr, "SMS", 1, $"k-{Guid.NewGuid()}"));
    }

    [Fact]
    public async Task Same_recipient_on_three_channels_is_allowed()
    {
        var (t, c, r, cr) = await SeedAsync();
        foreach (var ch in new[] { "WHATSAPP", "SMS", "EMAIL" })
            await InsertMessage(t, c, r, cr, ch, 1, $"k-{Guid.NewGuid()}");
    }

    [Fact]
    public async Task Duplicate_idempotency_key_in_tenant_is_rejected()
    {
        var (t, c, r, cr) = await SeedAsync();
        var key = $"k-{Guid.NewGuid()}";
        await InsertMessage(t, c, r, cr, "SMS", 1, key);
        await Assert.ThrowsAsync<SqlException>(() => InsertMessage(t, c, r, cr, "EMAIL", 1, key));
    }

    [Fact]
    public async Task Message_events_are_append_only_and_deduplicated()
    {
        var (t, c, r, cr) = await SeedAsync();
        await InsertMessage(t, c, r, cr, "SMS", 1, "evt-key");
        var insert = $"""
            INSERT MessageEvent(event_id, tenant_id, message_id, deduplication_key, event_type_raw, event_type, event_source, received_at, processed_at, signature_valid)
            SELECT NEWID(), '{t}', message_id, 'prov-evt-1', 'delivered', 'DELIVERED', 'WEBHOOK', SYSUTCDATETIME(), SYSUTCDATETIME(), 1
            FROM Message WHERE idempotency_key = 'evt-key';
            """;
        await db.Exec(insert);
        await Assert.ThrowsAsync<SqlException>(() => db.Exec(insert));                       // duplicate provider event
        await Assert.ThrowsAsync<SqlException>(() => db.Exec("UPDATE MessageEvent SET event_type = 'FAILED'"));
        await Assert.ThrowsAsync<SqlException>(() => db.Exec("DELETE FROM MessageEvent"));
    }

    [Fact]
    public async Task Document_key_is_unique_per_recipient_and_campaign()
    {
        var (t, c, _, cr) = await SeedAsync();
        var sql = $"""
            INSERT Document(document_id, tenant_id, campaign_id, campaign_recipient_id, document_key, generation_state, recipient_match_state)
            VALUES (NEWID(), '{t}', '{c}', '{cr}', 'INV-2026-11', 'PLANNED', 'UNCHECKED');
            """;
        await db.Exec(sql);
        await Assert.ThrowsAsync<SqlException>(() => db.Exec(sql));
    }

    [Fact]
    public async Task Message_cannot_reference_a_campaign_of_another_tenant()
    {
        var (_, c, _, _) = await SeedAsync();
        var (t2, _, r2, cr2) = await SeedAsync();
        // Only the campaign belongs to another tenant; revision and recipient belong to t2.
        var ex = await Assert.ThrowsAsync<SqlException>(() => InsertMessage(t2, c, r2, cr2, "SMS", 1, $"k-{Guid.NewGuid()}"));
        Assert.Equal(547, ex.Number);
        // With composite (tenant, campaign, ...) FKs a foreign campaign also breaks the revision and recipient FKs;
        // SQL Server reports whichever it checks first, so any of the three proves the cross-tenant reference is blocked.
        Assert.Matches("FK_Message_(Campaign|Revision|Recipient)", ex.Message);
    }

    [Fact]
    public async Task Document_cannot_reference_a_recipient_of_another_tenant()
    {
        var (_, _, _, cr) = await SeedAsync();
        var (t2, c2, _, _) = await SeedAsync();
        // Only the recipient belongs to another tenant; the campaign belongs to t2.
        var ex = await Assert.ThrowsAsync<SqlException>(() => db.Exec($"""
            INSERT Document(document_id, tenant_id, campaign_id, campaign_recipient_id, document_key, generation_state, recipient_match_state)
            VALUES (NEWID(), '{t2}', '{c2}', '{cr}', 'INV-X', 'PLANNED', 'UNCHECKED');
            """));
        Assert.Equal(547, ex.Number);
        Assert.Contains("FK_Document_Recipient", ex.Message);
    }

    [Fact]
    public async Task Same_identity_can_appear_in_two_snapshots_of_one_campaign()
    {
        var (t, c, _, _) = await SeedAsync();
        var snap2 = Guid.NewGuid();
        await db.Exec($"""
            INSERT AudienceSnapshot(audience_snapshot_id, tenant_id, audience_version_id, frozen_at)
              SELECT '{snap2}', tenant_id, audience_version_id, SYSUTCDATETIME()
              FROM AudienceSnapshot WHERE audience_snapshot_id =
                (SELECT audience_snapshot_id FROM CampaignRevision WHERE campaign_id = '{c}' AND revision_no = 1);
            INSERT CampaignRecipient(campaign_recipient_id, tenant_id, campaign_id, audience_snapshot_id, source_recipient_id, approved_identity_key)
              VALUES (NEWID(), '{t}', '{c}', '{snap2}', '000123', 'ID:000123');
            """);
    }

    // Adds a second campaign (own revision) and a recipient in the same tenant, reusing an existing snapshot.
    private async Task<(Guid campaign, Guid revision, Guid recipient)> AddCampaignAsync(Guid t, Guid existingCampaign, string identityKey)
    {
        Guid c = Guid.NewGuid(), r = Guid.NewGuid(), cr = Guid.NewGuid();
        await db.Exec($"""
            DECLARE @snap UNIQUEIDENTIFIER = (SELECT TOP 1 audience_snapshot_id FROM CampaignRevision WHERE campaign_id = '{existingCampaign}');
            INSERT Campaign(campaign_id, tenant_id, department_id, campaign_name, campaign_type, communication_purpose, campaign_state, created_by)
              VALUES ('{c}', '{t}', 'EDU', N'משלוח שני', 'MANUAL', 'SERVICE', 'DRAFT', 'user-1');
            INSERT CampaignRevision(campaign_revision_id, tenant_id, campaign_id, revision_no, audience_snapshot_id)
              VALUES ('{r}', '{t}', '{c}', 1, @snap);
            INSERT CampaignRecipient(campaign_recipient_id, tenant_id, campaign_id, audience_snapshot_id, source_recipient_id, approved_identity_key)
              VALUES ('{cr}', '{t}', '{c}', @snap, '000456', '{identityKey}');
            """);
        return (c, r, cr);
    }

    [Fact]
    public async Task Message_revision_must_belong_to_its_campaign()
    {
        var (t, c1, r1, cr1) = await SeedAsync();
        var (_, r2, _) = await AddCampaignAsync(t, c1, "ID:000456");
        var ex = await Assert.ThrowsAsync<SqlException>(() => InsertMessage(t, c1, r2, cr1, "SMS", 1, $"k-{Guid.NewGuid()}"));
        Assert.Equal(547, ex.Number);
        Assert.Contains("FK_Message_Revision", ex.Message);
    }

    [Fact]
    public async Task Message_recipient_must_belong_to_its_campaign()
    {
        var (t, c1, r1, _) = await SeedAsync();
        var (_, _, cr2) = await AddCampaignAsync(t, c1, "ID:000456");
        var ex = await Assert.ThrowsAsync<SqlException>(() => InsertMessage(t, c1, r1, cr2, "SMS", 1, $"k-{Guid.NewGuid()}"));
        Assert.Equal(547, ex.Number);
        Assert.Contains("FK_Message_Recipient", ex.Message);
    }

    [Fact]
    public async Task Document_cannot_be_linked_to_a_message_of_another_recipient()
    {
        var (t, c, r, crA) = await SeedAsync();
        var crB = Guid.NewGuid();
        Guid docA = Guid.NewGuid(), msgB = Guid.NewGuid();
        await db.Exec($"""
            INSERT CampaignRecipient(campaign_recipient_id, tenant_id, campaign_id, audience_snapshot_id, source_recipient_id, approved_identity_key)
              SELECT '{crB}', tenant_id, campaign_id, audience_snapshot_id, '000456', 'ID:000456'
              FROM CampaignRecipient WHERE campaign_recipient_id = '{crA}';
            INSERT Document(document_id, tenant_id, campaign_id, campaign_recipient_id, document_key, generation_state, recipient_match_state)
              VALUES ('{docA}', '{t}', '{c}', '{crA}', 'INV-A', 'PLANNED', 'UNCHECKED');
            INSERT Message(message_id, tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no,
                           idempotency_key, destination_value, processing_state, handoff_state, delivery_state, data_quality)
              VALUES ('{msgB}', '{t}', '{c}', '{r}', '{crB}', 'SMS', 1, 'k-{Guid.NewGuid()}', '+972500000002', 'PENDING', 'NOT_HANDED_OFF', 'NOT_REPORTED', 'CURRENT');
            """);

        Task Link(Guid recipientId) => db.Exec($"""
            INSERT MessageDocumentLink(message_document_link_id, tenant_id, campaign_recipient_id, message_id, document_id, delivery_mode, attachment_or_link_state)
            VALUES (NEWID(), '{t}', '{recipientId}', '{msgB}', '{docA}', 'ATTACHMENT', 'PLANNED');
            """);

        // Recipient A: the message (recipient B) is the only violated FK.
        var ex1 = await Assert.ThrowsAsync<SqlException>(() => Link(crA));
        Assert.Equal(547, ex1.Number);
        Assert.Contains("FK_Link_Message", ex1.Message);
        // Recipient B: the document (recipient A) is the only violated FK.
        var ex2 = await Assert.ThrowsAsync<SqlException>(() => Link(crB));
        Assert.Equal(547, ex2.Number);
        Assert.Contains("FK_Link_Document", ex2.Message);
    }

    [Theory]
    [InlineData("hash-A", "hash-A", 1)]
    [InlineData("hash-A", "hash-B", 2)]
    public async Task Idempotency_key_replay_and_conflict(string firstHash, string secondHash, int expectedSecondOutcome)
    {
        var (t, _, _, _) = await SeedAsync();
        var key = Guid.NewGuid().ToString();
        Assert.Equal(0, await Claim(t, key, firstHash));
        Assert.Equal(expectedSecondOutcome, await Claim(t, key, secondHash));
    }

    private async Task<int> Claim(Guid tenant, string key, string hash)
    {
        await using var conn = db.Open();
        await using var cmd = new SqlCommand("dbo.usp_ClaimIdempotencyKey", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TenantId", tenant);
        cmd.Parameters.AddWithValue("@OperationType", "campaign.release");
        cmd.Parameters.AddWithValue("@Key", key);
        cmd.Parameters.AddWithValue("@RequestHash", hash);
        var outcome = cmd.Parameters.Add("@Outcome", SqlDbType.TinyInt);
        outcome.Direction = ParameterDirection.Output;
        await cmd.ExecuteNonQueryAsync();
        return Convert.ToInt32(outcome.Value);
    }

    [Fact]
    public async Task Audience_member_identity_is_unique_per_version()
    {
        var (t, _, _, _) = await SeedAsync();
        var av = await db.ScalarAsync<Guid>($"SELECT TOP 1 audience_version_id FROM AudienceVersion WHERE tenant_id = '{t}'");
        var sql = $"""
            INSERT AudienceMember(audience_member_id, tenant_id, audience_version_id, source_row_number, source_recipient_id, approved_identity_key, validation_state)
            VALUES (NEWID(), '{t}', '{av}', 2, '000123', 'ID:000123', 'VALID');
            """;
        await db.Exec(sql);
        var ex = await Assert.ThrowsAsync<SqlException>(() => db.Exec(sql));
        Assert.Equal(2627, ex.Number);
    }

    [Fact]
    public async Task Outbox_rejects_second_dispatch_for_same_message()
    {
        var (t, c, r, cr) = await SeedAsync();
        await InsertMessage(t, c, r, cr, "SMS", 1, "ob-key");
        var sql = $"INSERT OutboxMessage(tenant_id, message_type, aggregate_id) SELECT '{t}', 'dispatch.sms', message_id FROM Message WHERE idempotency_key = 'ob-key'";
        await db.Exec(sql);
        var ex = await Assert.ThrowsAsync<SqlException>(() => db.Exec(sql));
        Assert.Equal(2627, ex.Number);
    }
}
