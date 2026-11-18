# Phase 1 · M1 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one flow work locally from start to finish: Excel/CSV upload → SMS campaign wizard → Preflight → approval → durable queue → mock provider → events → tracking screen. It runs against a new local SQL Server database named `whatsapp`, and the UI is Angular in the Muni language.

**Architecture:** One modular .NET 10 core. Domain holds pure rules; Infrastructure holds Dapper and the Outbox; Api is minimal APIs under `/v1`; Worker is a BackgroundService for dispatch and events. Angular (standalone, signals) uses our own components generated from Figma tokens. The mock login issues a local JWT, and `tenant_id` always comes from the token.

**Tech Stack:** .NET 10, C#, xUnit, Dapper, Microsoft.Data.SqlClient, ClosedXML, ASP.NET Core minimal APIs and JWT bearer, `Microsoft.AspNetCore.Mvc.Testing`, Angular (latest stable) with Angular CDK, Vitest or Karma (whatever `ng new` generates), Playwright, Node 24, SQL Server 2025 on `localhost`.

**Spec:** `docs/superpowers/specs/2026-11-17-phase1-m1-design.md`, which extends `docs/superpowers/specs/2026-11-17-resident-messaging-design.md` and `RESIDENT_COMMUNICATION_SPEC.md` §4, §5, §8, §9, §15, §16 and §21.

**Note on code completeness:** Domain rules (Tasks 2–3) and the schema (Task 1) give the full code. Later tasks give exact contracts, file paths, the required tests with test code, and acceptance criteria. Implementers write the remaining glue code to those contracts.

## Global Constraints

- **Database:** `whatsapp` on `localhost` (Windows auth, `TrustServerCertificate=true`). Create it if it's missing. Never touch any other database on the server. Tests use throwaway `ResidentComms_Test_<guid>` databases, as in phase 0.
- **Tenant:** `tenant_id` comes only from the authenticated principal. It is never read from the route, query or body (spec §15).
- **Idempotency:** `Idempotency-Key` is required on every POST, PUT and PATCH that creates or executes something, through `dbo.usp_ClaimIdempotencyKey`. GET requests don't need it (spec §21.4). A replay returns the stored result; the same key with a different body returns `409`.
- **Message key:** the message idempotency key is `SHA-256 hex of "tenant_id|campaign_id|approved_identity_key|channel|channel_sequence_no"`, with lowercase GUIDs (ADR-004).
- **Values:** phones, IDs and national IDs are strings. Raw and normalized values are stored separately. Lost leading zeros and scientific notation are flagged and never auto-restored (spec §5). Spreadsheet formulas are never evaluated.
- **No blind retry:** a timeout after the request left means handoff `Unknown`, with no automatic retry (spec §9, §21.4).
- **Events:** never lower a delivered state. Duplicates create no new business fact. A conflict is sticky through `Message.delivery_conflict` (phase 0).
- **Approval:** approval binds to `campaign_revision_id` plus the package hash. A material change creates a new revision and invalidates the approval. The creator can't approve above `self_approval_max_recipients` (default 1000). Release re-checks the approval, suppression and the send window (spec §21.2).
- **Display:** missing information shows as "לא ידוע", never as success or failure. Pending and unknown stay in the denominator.
- **Mock provider:** everything mocked is visibly labelled "Sandbox (מדומה)" in the UI and in API responses (`"environment":"sandbox-mock"`).
- **UI:** Hebrew, `dir="rtl"`, CSS logical properties only, Rubik, `font-variant-numeric: tabular-nums` for IDs and numbers. Colors come only from `src/frontend/design/tokens.json` → `tokens.css`. Use the post-AA values: text on the turquoise action color is `--color-text-on-action`.
- **Micro-copy (verbatim):** `"{N} הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן."` · `"טרם התקבל אישור מסירה."` · button `"אישור ושליחת {N} הודעות"`.
- **Public repo:** no secrets in the repo. The dev JWT signing key comes from user-secrets or an env var; `appsettings.Development.json` holds only a placeholder.
- Every commit ends with a `Co-Authored-By:` trailer naming the model.

## File Structure

```text
db/migrations/V003__m1_import_outbox_policy.sql
src/backend/ResidentComms.Domain/Import/PhoneNormalizer.cs
src/backend/ResidentComms.Domain/Content/TemplateRenderer.cs
src/backend/ResidentComms.Domain/Content/SmsSegments.cs
src/backend/ResidentComms.Domain/Campaigns/Preflight.cs
src/backend/ResidentComms.Domain/Campaigns/ApprovalPackage.cs
src/backend/ResidentComms.Domain/Campaigns/ApprovalPolicy.cs
src/backend/ResidentComms.Domain/Campaigns/MessageKey.cs
src/backend/ResidentComms.Infrastructure/...            (Sql, Import readers, Repositories, Outbox)
src/backend/ResidentComms.Api/...                       (Program, Auth, Idempotency, Endpoints)
src/backend/ResidentComms.Worker/...                    (Dispatcher, MockSmsAdapter, EventProcessor)
src/backend/tools/ResidentComms.DbMigrator/Program.cs
src/backend/tests/ResidentComms.Domain.Tests/...        (existing project, new tests)
src/backend/tests/ResidentComms.Db.Tests/...            (existing project, new tests)
src/backend/tests/ResidentComms.Api.Tests/...
src/frontend/                                           (Angular workspace)
docs/adr/ADR-005-m1-architecture.md
```

---

### Task 1: ADR-005, V003 migration and DbMigrator (creates the `whatsapp` database)

**Files:**
- Create: `docs/adr/ADR-005-m1-architecture.md`, `db/migrations/V003__m1_import_outbox_policy.sql`, `src/backend/tools/ResidentComms.DbMigrator/` (console app)
- Modify: `src/backend/tests/ResidentComms.Db.Tests/SchemaConstraintTests.cs` (add tests)

**Interfaces:**
- Produces these tables: `TenantPolicy`, `ImportRun`, `AudienceMember`, `SuppressionEntry`, `MessageContent`, `OutboxMessage`, plus new `CampaignRevision` columns (`audience_version_id`, `channel`, `content_text`, `field_defaults_json`).
- Produces `dotnet run --project src/backend/tools/ResidentComms.DbMigrator -- --database whatsapp`. It creates the database if missing, then applies every `db/migrations/V*.sql` not yet listed in table `SchemaVersion(version, applied_at)`.

- [ ] **Step 1: Write ADR-005**

```markdown
# ADR-005 — ארכיטקטורת M1

- מצב: התקבל, 17.11.2026
- החלטות: מסד `whatsapp` על SQL Server המקומי · Dapper מעל מיגרציות T-SQL · Outbox בטבלה + BackgroundService · כניסת פיתוח מדומה (JWT מקומי) מאחורי ITokenIssuer/ICurrentUser · ISmsAdapter עם MockSmsAdapter · רכיבי Angular משלנו מ-tokens.json + Angular CDK.
- נדחה: EF Core (כפילות מקור אמת לסכימה), RabbitMQ/Service Bus ב-M1 (תשתית נוספת ללא צורך), ספריית UI (פוגעת בנאמנות ל-Muni וב-RTL).
- פתוח: אירוח API (סוף M1), IdentityService מול OIDC (ADR-003).
```

- [ ] **Step 2: Write `db/migrations/V003__m1_import_outbox_policy.sql`**

```sql
-- V003: M1 — tenant policy, import, suppression, message content, outbox. Composite tenant FKs as in V001.
CREATE TABLE TenantPolicy (
    tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES Tenant(tenant_id),
    send_window_start TIME(0) NOT NULL DEFAULT '08:00',
    send_window_end TIME(0) NOT NULL DEFAULT '20:00',
    time_zone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jerusalem',
    self_approval_max_recipients INT NOT NULL DEFAULT 1000,
    duplicate_window_days INT NOT NULL DEFAULT 7,
    policy_version INT NOT NULL DEFAULT 1
);

CREATE TABLE ImportRun (
    import_run_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    source_object_name NVARCHAR(260) NOT NULL,
    source_sha256 CHAR(64) NOT NULL,
    detected_encoding VARCHAR(30) NULL,
    sheet_name NVARCHAR(100) NULL,
    row_count INT NOT NULL,
    valid_count INT NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ImportRun_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);

CREATE TABLE AudienceMember (
    audience_member_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    source_row_number INT NOT NULL,
    source_recipient_id NVARCHAR(100) NOT NULL,
    approved_identity_key NVARCHAR(200) NOT NULL,
    recipient_name NVARCHAR(200) NULL,
    phone_raw NVARCHAR(100) NULL,
    phone_normalized VARCHAR(20) NULL,
    email_raw NVARCHAR(320) NULL,
    email_normalized NVARCHAR(320) NULL,
    variables_json NVARCHAR(MAX) NULL,
    validation_state VARCHAR(10) NOT NULL CHECK (validation_state IN ('VALID','WARNING','INVALID')),
    validation_codes VARCHAR(400) NULL,
    CONSTRAINT UQ_AudienceMember_Identity UNIQUE (tenant_id, audience_version_id, approved_identity_key),
    CONSTRAINT FK_AudienceMember_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);

CREATE TABLE SuppressionEntry (
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    destination_normalized NVARCHAR(320) NOT NULL,
    reason VARCHAR(30) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_SuppressionEntry PRIMARY KEY (tenant_id, channel, destination_normalized)
);

ALTER TABLE CampaignRevision ADD
    audience_version_id UNIQUEIDENTIFIER NULL,
    channel VARCHAR(10) NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    content_text NVARCHAR(2000) NULL,
    field_defaults_json NVARCHAR(MAX) NULL;
GO
ALTER TABLE CampaignRevision ADD CONSTRAINT FK_CampaignRevision_AudienceVersion
    FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id);
GO

-- Rendered content kept apart from Message so it can be purged by retention policy (spec §15, §21.6).
CREATE TABLE MessageContent (
    message_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    rendered_text NVARCHAR(2000) NULL,     -- NULL after purge
    purged_at DATETIME2(3) NULL,
    CONSTRAINT FK_MessageContent_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id)
);

CREATE TABLE OutboxMessage (
    outbox_id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_type VARCHAR(50) NOT NULL,          -- e.g. 'dispatch.sms'
    aggregate_id UNIQUEIDENTIFIER NOT NULL,     -- message_id
    payload NVARCHAR(MAX) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    available_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    locked_until DATETIME2(3) NULL,
    processed_at DATETIME2(3) NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error NVARCHAR(400) NULL,
    CONSTRAINT UQ_Outbox_Aggregate UNIQUE (message_type, aggregate_id)
);
CREATE INDEX IX_Outbox_Pending ON OutboxMessage(available_at) WHERE processed_at IS NULL;
GO
```

- [ ] **Step 3: Add failing Db tests** to `SchemaConstraintTests.cs`. Use the existing `SeedAsync`/`InsertMessage` helpers and the `TestDatabase` fixture.

```csharp
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
```

Add `public async Task<T> ScalarAsync<T>(string sql)` to `TestDatabase`: open a connection, run `ExecuteScalarAsync`, and return `(T)result`.

- [ ] **Step 4: Run, expect FAIL** (`Invalid object name 'AudienceMember'`): `dotnet test src/backend/tests/ResidentComms.Db.Tests`

- [ ] **Step 5: Add V003** (Step 2 content) and run again. Expect PASS: 15 Db tests (13 existing + 2).

- [ ] **Step 6: Build the DbMigrator.** Console app `net10.0` referencing Microsoft.Data.SqlClient. Arguments: `--server` (default `localhost`), `--database` (required). Behavior:
  - `IF DB_ID(@db) IS NULL CREATE DATABASE [db]`.
  - Create `SchemaVersion(version VARCHAR(50) PRIMARY KEY, applied_at DATETIME2(3))` if missing.
  - Apply each `V*.sql` file in ordinal order (split on `GO` lines, same regex as `TestDatabase`), each inside its own transaction, and insert its row.
  - Print `applied: V00x…` or `up to date`.
  - Refuse a database name that isn't `whatsapp` or doesn't start with `ResidentComms_` (guard against touching other databases).

- [ ] **Step 7: Create the real database.** Run `dotnet run --project src/backend/tools/ResidentComms.DbMigrator -- --database whatsapp`. Expect `applied: V001, V002, V003`. Run it again and expect `up to date`. Verify with `sqlcmd -S localhost -E -C -d whatsapp -Q "select version from SchemaVersion"`, which should show 3 rows.

- [ ] **Step 8: Seed the dev tenant.** Add `db/seed/dev-seed.sql`: one tenant `מועצה אזורית דוגמה` with fixed GUID `11111111-1111-1111-1111-111111111111`, plus its `TenantPolicy` row. The migrator applies it with flag `--seed-dev`, only to `whatsapp`, and the operation is idempotent (`IF NOT EXISTS`).

- [ ] **Step 9: Commit**: `git add docs/adr/ADR-005-m1-architecture.md db src/backend && git commit -m "feat(db): V003 import/outbox/policy, DbMigrator creates whatsapp database"`

---

### Task 2: Domain — phone normalization, template rendering, SMS segments

**Files:**
- Create: `src/backend/ResidentComms.Domain/Import/PhoneNormalizer.cs`, `Content/TemplateRenderer.cs`, `Content/SmsSegments.cs`
- Test: `src/backend/tests/ResidentComms.Domain.Tests/Import/PhoneNormalizerTests.cs`, `Content/TemplateRendererTests.cs`, `Content/SmsSegmentsTests.cs`

**Interfaces (produces):**
- `[Flags] enum PhoneIssue { None=0, Empty=1, ScientificNotation=2, LostLeadingZero=4, InvalidLength=8, NotMobile=16, NonDigits=32 }`
- `record PhoneResult(string? Raw, string? Normalized, PhoneIssue Issues) { bool IsValidMobile => Normalized is not null; }`
- `static PhoneResult PhoneNormalizer.NormalizeIsraeliMobile(string? raw)`
- `record RenderResult(string Text, IReadOnlyList<string> MissingFields)`
- `static RenderResult TemplateRenderer.Render(string template, IReadOnlyDictionary<string,string?> values, IReadOnlyDictionary<string,string>? defaults = null)`. Tokens are `{שם_שדה}`, using any non-`}` characters.
- `enum SmsEncoding { Gsm7, Ucs2 }`; `record SmsCount(SmsEncoding Encoding, int Characters, int Segments)`; `static SmsCount SmsSegments.Count(string text)`

- [ ] **Step 1: Write failing tests**

```csharp
// PhoneNormalizerTests.cs
using ResidentComms.Domain.Import;
namespace ResidentComms.Domain.Tests.Import;
public class PhoneNormalizerTests
{
    [Theory]
    [InlineData("052-1234567", "+972521234567")]
    [InlineData("0521234567", "+972521234567")]
    [InlineData("+972 52 123 4567", "+972521234567")]
    [InlineData("972521234567", "+972521234567")]
    public void Normalizes_valid_israeli_mobiles(string raw, string expected)
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile(raw);
        Assert.Equal(expected, r.Normalized);
        Assert.Equal(raw, r.Raw);
        Assert.Equal(PhoneIssue.None, r.Issues);
    }

    [Fact]
    public void Lost_leading_zero_is_flagged_not_restored()
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile("521234567");
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(PhoneIssue.LostLeadingZero));
    }

    [Fact]
    public void Scientific_notation_is_flagged()
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile("5.21234567E+08");
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(PhoneIssue.ScientificNotation));
    }

    [Theory]
    [InlineData("", PhoneIssue.Empty)]
    [InlineData(null, PhoneIssue.Empty)]
    [InlineData("052-123", PhoneIssue.InvalidLength)]
    [InlineData("03-6123456", PhoneIssue.NotMobile)]
    [InlineData("05x1234567", PhoneIssue.NonDigits)]
    public void Invalid_inputs_are_flagged(string? raw, PhoneIssue issue)
    {
        var r = PhoneNormalizer.NormalizeIsraeliMobile(raw);
        Assert.Null(r.Normalized);
        Assert.True(r.Issues.HasFlag(issue));
    }
}

// TemplateRendererTests.cs
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

// SmsSegmentsTests.cs
using ResidentComms.Domain.Content;
namespace ResidentComms.Domain.Tests.Content;
public class SmsSegmentsTests
{
    [Fact] public void Hebrew_70_chars_is_one_segment() => Assert.Equal(new SmsCount(SmsEncoding.Ucs2, 70, 1), SmsSegments.Count(new string('א', 70)));
    [Fact] public void Hebrew_71_chars_is_two_segments_of_67() => Assert.Equal(2, SmsSegments.Count(new string('א', 71)).Segments);
    [Fact] public void Hebrew_135_chars_is_three_segments() => Assert.Equal(3, SmsSegments.Count(new string('א', 135)).Segments);
    [Fact] public void Latin_160_is_one_gsm_segment() => Assert.Equal(new SmsCount(SmsEncoding.Gsm7, 160, 1), SmsSegments.Count(new string('a', 160)));
    [Fact] public void Latin_161_is_two_gsm_segments() => Assert.Equal(2, SmsSegments.Count(new string('a', 161)).Segments);
    [Fact] public void Empty_text_is_zero_segments() => Assert.Equal(0, SmsSegments.Count("").Segments);
}
```

- [ ] **Step 2: Run, expect a build FAIL** (types missing): `dotnet test src/backend/ResidentComms.slnx`

- [ ] **Step 3: Implement**

```csharp
// PhoneNormalizer.cs
using System.Text.RegularExpressions;
namespace ResidentComms.Domain.Import;

[Flags] public enum PhoneIssue { None = 0, Empty = 1, ScientificNotation = 2, LostLeadingZero = 4, InvalidLength = 8, NotMobile = 16, NonDigits = 32 }

public sealed record PhoneResult(string? Raw, string? Normalized, PhoneIssue Issues) { public bool IsValidMobile => Normalized is not null; }

/// <summary>Israeli mobile → E.164. Never restores lost digits (spec §5); syntactic validity is not proof of ownership.</summary>
public static partial class PhoneNormalizer
{
    [GeneratedRegex(@"^\d(\.\d+)?E\+\d+$", RegexOptions.IgnoreCase)] private static partial Regex Scientific();

    public static PhoneResult NormalizeIsraeliMobile(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new(raw, null, PhoneIssue.Empty);
        var trimmed = raw.Trim();
        if (Scientific().IsMatch(trimmed)) return new(raw, null, PhoneIssue.ScientificNotation);
        var compact = trimmed.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "");
        if (compact.StartsWith('+')) compact = compact[1..];
        if (!compact.All(char.IsAsciiDigit)) return new(raw, null, PhoneIssue.NonDigits);
        string national;
        if (compact.StartsWith("972")) national = "0" + compact[3..];
        else if (compact.Length == 9 && compact[0] == '5') return new(raw, null, PhoneIssue.LostLeadingZero);
        else national = compact;
        if (national.Length != 10) return new(raw, null, PhoneIssue.InvalidLength);
        if (!national.StartsWith("05")) return new(raw, null, PhoneIssue.NotMobile);
        return new(raw, "+972" + national[1..], PhoneIssue.None);
    }
}
```

`03-6123456` is 9 digits, so it must report `NotMobile`. Order the checks so that a 9-digit number that doesn't start with `5` returns `NotMobile` (landline) and not `InvalidLength`: after `compact.Length == 9 && compact[0]=='5'`, add `if (compact.Length == 9 && compact[0] == '0') return new(raw, null, PhoneIssue.NotMobile);`.

```csharp
// TemplateRenderer.cs
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

// SmsSegments.cs
namespace ResidentComms.Domain.Content;
public enum SmsEncoding { Gsm7, Ucs2 }
public sealed record SmsCount(SmsEncoding Encoding, int Characters, int Segments);

/// <summary>Estimate only — verify with the chosen provider (spec §6). GSM-7 basic set approximated as ASCII printable.</summary>
public static class SmsSegments
{
    public static SmsCount Count(string text)
    {
        var len = text.Length;
        var gsm = text.All(c => c is >= ' ' and <= '~' or '\n' or '\r');
        var (single, multi) = gsm ? (160, 153) : (70, 67);
        var segments = len == 0 ? 0 : len <= single ? 1 : (int)Math.Ceiling(len / (double)multi);
        return new(gsm ? SmsEncoding.Gsm7 : SmsEncoding.Ucs2, len, segments);
    }
}
```

- [ ] **Step 4: Run, expect PASS** for all new tests (11 phone, 2 template, 6 SMS). Domain total: 29 + 19 = 48.

- [ ] **Step 5: Commit**: `git commit -m "feat(domain): phone normalization, template rendering, SMS segment count"`

---

### Task 3: Domain — Preflight, approval package hash, approval policy, message key

**Files:**
- Create: `src/backend/ResidentComms.Domain/Campaigns/Preflight.cs`, `ApprovalPackage.cs`, `ApprovalPolicy.cs`, `MessageKey.cs`
- Test: `src/backend/tests/ResidentComms.Domain.Tests/Campaigns/*Tests.cs`

**Interfaces (produces):**
- `enum PreflightSeverity { Blocker, Warning }` · `record PreflightFinding(string Code, PreflightSeverity Severity, string MessageHe, string Step)`
- `record PreflightInput(int EligibleRecipients, IReadOnlyList<string> MissingFields, int RecipientsWithMissingFields, bool DuplicateInWindow, int? PreviousAudienceSize, DateTimeOffset ScheduledAtLocal, TimeOnly WindowStart, TimeOnly WindowEnd, bool CostIsEstimate)`
- `static IReadOnlyList<PreflightFinding> Preflight.Evaluate(PreflightInput i)`. Codes: `NO_ELIGIBLE` (blocker, step "למי"), `MISSING_FIELD` (blocker, "מה"), `DUPLICATE_SEND` (blocker, "בדיקה"), `AUDIENCE_SIZE_CHANGE` (warning when the change vs previous is >= 5%, "למי"), `OUTSIDE_SEND_WINDOW` (warning, "אישור ושליחה"), `COST_ESTIMATE_ONLY` (warning, "איך").
- `record ApprovalPackageContent(Guid CampaignRevisionId, Guid AudienceVersionId, string Channel, string ContentText, IReadOnlyDictionary<string,string> FieldDefaults, DateTimeOffset? ScheduledAt, int PolicyVersion)`
- `static string ApprovalPackage.Hash(ApprovalPackageContent c)` returns lowercase SHA-256 hex of canonical JSON. Keys are sorted ordinally, FieldDefaults are sorted, ScheduledAt is in UTC ISO-8601 format `O` or `null`, and GUIDs are lowercase with dashes.
- `enum ApprovalDecision { Allowed, SelfApprovalAboveThreshold, NotApproverRole, StaleRevision }`
- `static ApprovalDecision ApprovalPolicy.Check(string approverId, bool approverHasRole, string creatorId, int recipients, int selfApprovalMax, string packageHashAtSubmit, string currentPackageHash)`
- `static string MessageKey.For(Guid tenantId, Guid campaignId, string approvedIdentityKey, string channel, int sequenceNo)` builds `SHA256("t|c|identity|CHANNEL|n")` in lowercase hex with lowercase GUIDs (ADR-004).

- [ ] **Step 1: Write failing tests**

```csharp
using ResidentComms.Domain.Campaigns;
namespace ResidentComms.Domain.Tests.Campaigns;

public class PreflightTests
{
    private static PreflightInput Ok() => new(3180, [], 0, false, 3000,
        new DateTimeOffset(2026, 11, 17, 10, 0, 0, TimeSpan.FromHours(2)), new TimeOnly(8, 0), new TimeOnly(20, 0), true);

    [Fact] public void Clean_input_has_only_cost_warning()
        => Assert.Equal(new[] { "AUDIENCE_SIZE_CHANGE", "COST_ESTIMATE_ONLY" }, Preflight.Evaluate(Ok()).Select(f => f.Code).Order());

    [Fact] public void No_eligible_recipients_blocks()
        => Assert.Contains(Preflight.Evaluate(Ok() with { EligibleRecipients = 0 }), f => f.Code == "NO_ELIGIBLE" && f.Severity == PreflightSeverity.Blocker);

    [Fact] public void Missing_field_blocks_and_names_the_count()
    {
        var f = Preflight.Evaluate(Ok() with { MissingFields = ["שם_ילד"], RecipientsWithMissingFields = 14 }).Single(x => x.Code == "MISSING_FIELD");
        Assert.Equal(PreflightSeverity.Blocker, f.Severity);
        Assert.Contains("14", f.MessageHe);
        Assert.Contains("שם_ילד", f.MessageHe);
    }

    [Fact] public void Duplicate_send_blocks()
        => Assert.Contains(Preflight.Evaluate(Ok() with { DuplicateInWindow = true }), f => f.Code == "DUPLICATE_SEND" && f.Severity == PreflightSeverity.Blocker);

    [Fact] public void Outside_window_is_a_warning_not_a_blocker()
        => Assert.Contains(Preflight.Evaluate(Ok() with { ScheduledAtLocal = new DateTimeOffset(2026, 11, 17, 21, 30, 0, TimeSpan.FromHours(2)) }),
            f => f.Code == "OUTSIDE_SEND_WINDOW" && f.Severity == PreflightSeverity.Warning);

    [Fact] public void Small_audience_change_is_not_flagged()
        => Assert.DoesNotContain(Preflight.Evaluate(Ok() with { PreviousAudienceSize = 3150 }), f => f.Code == "AUDIENCE_SIZE_CHANGE");
}

public class ApprovalPackageTests
{
    private static ApprovalPackageContent C() => new(Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001"), Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002"),
        "SMS", "שלום {שם_הורה}", new Dictionary<string, string> { ["b"] = "2", ["a"] = "1" }, null, 1);

    [Fact] public void Hash_is_stable_and_order_independent()
    {
        var reordered = C() with { FieldDefaults = new Dictionary<string, string> { ["a"] = "1", ["b"] = "2" } };
        Assert.Equal(ApprovalPackage.Hash(C()), ApprovalPackage.Hash(reordered));
        Assert.Matches("^[0-9a-f]{64}$", ApprovalPackage.Hash(C()));
    }

    [Fact] public void Any_material_change_changes_the_hash()
    {
        var h = ApprovalPackage.Hash(C());
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { ContentText = "שלום" }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { AudienceVersionId = Guid.NewGuid() }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { ScheduledAt = DateTimeOffset.UnixEpoch }));
        Assert.NotEqual(h, ApprovalPackage.Hash(C() with { PolicyVersion = 2 }));
    }
}

public class ApprovalPolicyTests
{
    [Fact] public void Creator_cannot_self_approve_above_threshold()
        => Assert.Equal(ApprovalDecision.SelfApprovalAboveThreshold, ApprovalPolicy.Check("u1", true, "u1", 3180, 1000, "h", "h"));
    [Fact] public void Creator_may_self_approve_at_or_below_threshold()
        => Assert.Equal(ApprovalDecision.Allowed, ApprovalPolicy.Check("u1", true, "u1", 1000, 1000, "h", "h"));
    [Fact] public void Approver_role_is_required()
        => Assert.Equal(ApprovalDecision.NotApproverRole, ApprovalPolicy.Check("u2", false, "u1", 10, 1000, "h", "h"));
    [Fact] public void Changed_package_is_stale()
        => Assert.Equal(ApprovalDecision.StaleRevision, ApprovalPolicy.Check("u2", true, "u1", 10, 1000, "h1", "h2"));
}

public class MessageKeyTests
{
    [Fact] public void Key_excludes_revision_and_is_deterministic()
    {
        var t = Guid.Parse("11111111-1111-1111-1111-111111111111"); var c = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var k = MessageKey.For(t, c, "ID:000123", "SMS", 1);
        Assert.Equal(k, MessageKey.For(t, c, "ID:000123", "sms", 1));
        Assert.Matches("^[0-9a-f]{64}$", k);
        Assert.NotEqual(k, MessageKey.For(t, c, "ID:000123", "SMS", 2));
    }
}
```

- [ ] **Step 2: Run, expect a build FAIL.**

- [ ] **Step 3: Implement.**
  - `Preflight.Evaluate` checks in the order the tests imply.
  - The `MISSING_FIELD` message is `$"שדה דינמי חסר: \"{string.Join(", ", i.MissingFields)}\" ב-{i.RecipientsWithMissingFields} נמענים"`.
  - The audience-change rule is `PreviousAudienceSize is > 0 && Math.Abs(i.EligibleRecipients - prev) / (double)prev >= 0.05`. The message is `$"שינוי חריג בגודל הקהל: {pct:+0;-0}% מול הגרסה הקודמת"`.
  - The window rule compares `TimeOnly.FromDateTime(ScheduledAtLocal.DateTime)` against `[WindowStart, WindowEnd)`.
  - `ApprovalPackage.Hash` uses `System.Text.Json` with a `SortedDictionary` built from the record fields. The keys are `audience_version_id`, `campaign_revision_id`, `channel`, `content_text`, `field_defaults` (a `SortedDictionary`, ordinal), `policy_version` and `scheduled_at`. Serialize with `JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }`, then `SHA256.HashData(UTF8)` and `Convert.ToHexStringLower`.
  - `ApprovalPolicy.Check` checks role, then stale, then self-approval, in that order. A non-approver gets `NotApproverRole` even when the package is stale.
  - `MessageKey.For` builds `$"{tenant:D}|{campaign:D}|{identity}|{channel.ToUpperInvariant()}|{seq}"` with `.ToLowerInvariant()` on the GUIDs, then SHA-256 lowercase hex.

- [ ] **Step 4: Run, expect PASS.** Domain total: 48 + 13 = 61.

- [ ] **Step 5: Commit**: `git commit -m "feat(domain): preflight rules, approval package hash and policy, message key"`

---

### Task 4: Infrastructure — XLSX/CSV import readers

**Files:**
- Create: `src/backend/ResidentComms.Infrastructure/ResidentComms.Infrastructure.csproj` (net10.0; packages: `ClosedXML`, `Dapper`, `Microsoft.Data.SqlClient`, `System.Text.Encoding.CodePages`; references Domain), `Import/SpreadsheetReader.cs`, `Import/ImportValidator.cs`
- Create: `src/backend/tests/ResidentComms.Infrastructure.Tests/` (xunit; fixtures in `Fixtures/`)

**Interfaces (produces):**
- `record SheetData(IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string?>> Rows, string? SheetName, string? DetectedEncoding)`
- `static SheetData SpreadsheetReader.Read(Stream content, string fileName)`:
  - `.xlsx` uses ClosedXML and reads `cell.GetFormattedString()` for every cell, never `.Value`. For formula cells it returns `cell.FormulaA1` prefixed with `=` and never evaluates it.
  - `.csv` detects UTF-8 with a BOM, otherwise strict UTF-8, otherwise falls back to Windows-1255 (register `CodePagesEncodingProvider`).
  - Any other extension throws `UnsupportedFileException`.
- `record ImportMapping(string IdColumn, string? NameColumn, string PhoneColumn, IReadOnlyList<string> VariableColumns)`
- `record ValidatedRow(int SourceRowNumber, string SourceRecipientId, string IdentityKey, string? Name, PhoneResult Phone, IReadOnlyDictionary<string,string?> Variables, string State, IReadOnlyList<string> Codes)`. State is `VALID|WARNING|INVALID`. Codes come from `PhoneIssue` flags plus `DUPLICATE_ID`, `FORMULA_VALUE` and `ID_SCIENTIFIC`.
- `static IReadOnlyList<ValidatedRow> ImportValidator.Validate(SheetData sheet, ImportMapping map)`:
  - The identity key is `"ID:" + trimmed id`.
  - The first occurrence of an identity is kept. Later ones are `INVALID` with `DUPLICATE_ID`.
  - A cell starting with `=` is `INVALID` with `FORMULA_VALUE`.
  - An ID in scientific notation is `INVALID` with `ID_SCIENTIFIC`.
  - An invalid phone is `INVALID`.

- [ ] **Step 1: Create fixtures** with a small C# test helper that generates them via ClosedXML in the test's `InitializeAsync`, so no binary files go into the repo:
  - XLSX sheet "נובמבר" with headers `גן, שם ילד, שם הורה, טל נייד הורה, ת.ז`.
  - Rows: a valid row; a phone `521234567` stored as a number (lost zero); an ID `1.23E+08`; a duplicate ID; a cell with formula `=1+1`.
  - A CSV file in Windows-1255 with the same headers, written with `Encoding.GetEncoding(1255)`.

- [ ] **Step 2: Write failing tests**

```csharp
public class SpreadsheetReaderTests
{
    [Fact] public void Xlsx_reads_values_as_strings_and_never_evaluates_formulas()
    {
        using var s = Fixtures.Xlsx();
        var sheet = SpreadsheetReader.Read(s, "הורי גנים.xlsx");
        Assert.Equal("נובמבר", sheet.SheetName);
        var formulaRow = sheet.Rows.Single(r => r[4] == Fixtures.FormulaRowId);   // fixture puts =1+1 in column "שם הורה" of this row
        Assert.Equal("=1+1", formulaRow[2]);                                      // raw formula text, never the evaluated "2"
        var lostZeroRow = sheet.Rows.Single(r => r[4] == Fixtures.LostZeroRowId);
        Assert.Equal("521234567", lostZeroRow[3]);                                // numeric cell read as its formatted string
    }

    [Fact] public void Csv_windows_1255_is_detected()
    {
        using var s = Fixtures.CsvWindows1255();
        var sheet = SpreadsheetReader.Read(s, "a.csv");
        Assert.Equal("windows-1255", sheet.DetectedEncoding);
        Assert.Equal("שם הורה", sheet.Headers[2]);
    }

    [Fact] public void Unsupported_extension_throws()
        => Assert.Throws<UnsupportedFileException>(() => SpreadsheetReader.Read(new MemoryStream(), "a.xls"));
}

public class ImportValidatorTests
{
    private static readonly ImportMapping Map = new("ת.ז", "שם הורה", "טל נייד הורה", ["שם ילד", "גן"]);

    [Fact] public void Flags_lost_zero_scientific_id_formula_and_duplicate()
    {
        using var s = Fixtures.Xlsx();
        var rows = ImportValidator.Validate(SpreadsheetReader.Read(s, "x.xlsx"), Map);
        Assert.Contains(rows, r => r.State == "VALID" && r.Phone.Normalized == "+972521234567");
        Assert.Contains(rows, r => r.Codes.Contains("LostLeadingZero") && r.State == "INVALID");
        Assert.Contains(rows, r => r.Codes.Contains("ID_SCIENTIFIC"));
        Assert.Contains(rows, r => r.Codes.Contains("FORMULA_VALUE"));
        Assert.Single(rows, r => r.Codes.Contains("DUPLICATE_ID"));
    }
}
```

`Fixtures` exposes constants `FormulaRowId`, `LostZeroRowId`, `ScientificIdText` (`"1.23E+08"`) and `DuplicateId`, so tests address rows by ID and not by position.

- [ ] **Step 3: Run, expect FAIL.** Then **Step 4: Implement.** Then **Step 5: Run, expect PASS.**
- [ ] **Step 6: Commit**: `git commit -m "feat(infra): XLSX/CSV readers (strings only, no formula evaluation, Windows-1255) and import validation"`

---

### Task 5: API foundation — mock auth, tenant principal, Idempotency, health

**Files:**
- Create: `src/backend/ResidentComms.Api/` (web, net10.0; references Domain and Infrastructure; package `Microsoft.AspNetCore.Authentication.JwtBearer`)
- Create: `src/backend/ResidentComms.Infrastructure/Sql/SqlConnectionFactory.cs`, `Sql/IdempotencyStore.cs`
- Create: `src/backend/tests/ResidentComms.Api.Tests/` (xunit + `Microsoft.AspNetCore.Mvc.Testing`). The fixture creates a test database with DbMigrator logic (reuse a shared `MigrationRunner` class in Infrastructure) and seeds the dev tenant.

**Interfaces (produces):**
- `GET /health` returns `200 {"status":"ok","environment":"sandbox-mock"}`.
- `GET /v1/dev/users` returns the synthetic users (Development environment only): `[{id:"dana", name:"דנה לוי", role:"creator"}, {id:"meir", name:"מאיר ברק", role:"approver"}, {id:"rina", name:"רינה כהן", role:"analyst"}]`. All belong to tenant `11111111-1111-1111-1111-111111111111`, department `EDU`.
- `POST /v1/dev/login {userId}` returns `{token}` (Development only). The token is a JWT with claims `sub`, `name`, `role`, `tenant_id`, `department_id`, signed with `Auth:DevSigningKey` (user-secrets or env var, at least 32 bytes). The endpoint returns 404 outside Development.
- `interface ICurrentUser { string UserId; string Role; Guid TenantId; string DepartmentId; }`, read from claims only.
- `IdempotencyFilter` (endpoint filter) applies to every POST, PUT and PATCH under `/v1` except `/v1/dev/*` and `/v1/provider-events/*`:
  - A missing header returns `400 {"code":"IDEMPOTENCY_KEY_REQUIRED"}`.
  - The request hash is SHA-256 of method, path and body.
  - It calls `usp_ClaimIdempotencyKey(tenant, "{method} {routePattern}", key, hash)`. Outcome 1 returns the stored response (status and body saved in `result_ref` as JSON; add a `usp_SetIdempotencyResult` procedure in a `V004__idempotency_result.sql` migration). Outcome 2 returns `409 {"code":"IDEMPOTENCY_CONFLICT"}`.

- [ ] **Step 1: Write failing API tests**

```csharp
public class FoundationTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact] public async Task Health_reports_sandbox()
        => Assert.Contains("sandbox-mock", await f.CreateClient().GetStringAsync("/health"));

    [Fact] public async Task Unauthenticated_v1_call_is_401()
        => Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/v1/campaigns")).StatusCode);

    [Fact] public async Task Post_without_idempotency_key_is_400()
    {
        var c = await f.LoginAs("dana");
        var r = await c.PostAsJsonAsync("/v1/campaigns", new { name = "x", purpose = "SERVICE" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("IDEMPOTENCY_KEY_REQUIRED", await r.Content.ReadAsStringAsync());
    }

    [Fact] public async Task Same_key_same_body_replays_and_different_body_conflicts()
    {
        var c = await f.LoginAs("dana"); var key = Guid.NewGuid().ToString();
        var a = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "א", purpose = "SERVICE" }, key);
        var b = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "א", purpose = "SERVICE" }, key);
        var d = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "ב", purpose = "SERVICE" }, key);
        Assert.Equal(await a.Content.ReadAsStringAsync(), await b.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, d.StatusCode);
    }

    [Fact] public async Task Tenant_comes_from_token_not_body()
    {
        var c = await f.LoginAs("dana");
        var r = await c.SendWithKey(HttpMethod.Post, "/v1/campaigns", new { name = "x", purpose = "SERVICE", tenantId = Guid.NewGuid() }, Guid.NewGuid().ToString());
        var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("campaignId").GetGuid();
        Assert.Equal(ApiFactory.DevTenant, await f.Db.ScalarAsync<Guid>($"SELECT tenant_id FROM Campaign WHERE campaign_id = '{id}'"));
    }
}
```

`ApiFactory` exposes `LoginAs(userId)` (calls `/v1/dev/login` and sets the bearer header), `SendWithKey(...)` (adds `Idempotency-Key`), `Db` (the test database helper) and `DevTenant`. These tests need `POST /v1/campaigns`, which is Task 6. Implement a minimal version here that returns `201 {campaignId}` and creates the Campaign plus Revision 1. Task 6 extends it.

- [ ] **Step 2: Run, expect FAIL.** Then **Step 3: Implement** (Program.cs with JWT bearer, authorization fallback policy "authenticated" on `/v1`, `ICurrentUser`, `IdempotencyFilter`, V004 migration). Then **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**: `git commit -m "feat(api): mock dev login, tenant principal, idempotency filter, health"`

---

### Task 6: API — import, campaign draft, preflight, submit, approve, release

**Files:**
- Create: `src/backend/ResidentComms.Api/Endpoints/ImportEndpoints.cs`, `CampaignEndpoints.cs`
- Create: `src/backend/ResidentComms.Infrastructure/Repositories/AudienceRepository.cs`, `CampaignRepository.cs`, `ReleaseService.cs`
- Test: `src/backend/tests/ResidentComms.Api.Tests/CampaignFlowTests.cs`

**Interfaces (produces), all under `/v1` with the tenant from the token:**

| Method & path | Body | Response |
|---|---|---|
| `POST /import-jobs` (multipart: `file`, `mapping` JSON, optional `audienceName`) | — | `201 {importRunId, audienceId, audienceVersionId, rowCount, validCount, invalidCount, codes:{code:count}, sample:[first 5 rows, phone masked]}` |
| `GET /import-jobs/{id}/errors` | — | `200 [{row, sourceRecipientId, codes[]}]` |
| `POST /campaigns` | `{name, purpose}` | `201 {campaignId, revisionId}` |
| `PATCH /campaigns/{id}/draft` | `{audienceVersionId?, channel?, contentText?, fieldDefaults?, scheduledAt?}` | `200 {revisionId, approvalInvalidated: bool}`. A material change after submit creates a new revision and sets `invalidated_at` on the approval |
| `POST /campaigns/{id}/preflight` | — | `200 {findings:[{code,severity,messageHe,step}], eligibleRecipients, segmentsPerMessage, encoding, estimatedCost:{min,max,currency:"ILS",isEstimate:true}}` |
| `POST /campaigns/{id}/submit` | `{note?}` | `200 {packageHash}`, or `422 {code:"PREFLIGHT_BLOCKED", findings}` |
| `POST /campaigns/{id}/approve` | `{packageHash}` | `200`, or `403 {code:"SELF_APPROVAL_ABOVE_THRESHOLD"|"NOT_APPROVER"}`, or `409 {code:"STALE_REVISION"}` |
| `POST /campaigns/{id}/release` | — | `202 {messagesCreated, suppressed, environment:"sandbox-mock"}`, or `409 {code:"APPROVAL_INVALID"}`, or `422 {code:"OUTSIDE_SEND_WINDOW"}` |
| `GET /campaigns` | — | `200 [{campaignId, name, purpose, state, channel, recipients, counts:{accepted,delivered,unknown,failed}, dataAsOf}]` |
| `GET /approvals` | — | campaigns in state `SUBMITTED` that the current user may approve |

Release runs in one transaction. It re-checks the approval hash against the current revision, the `SuppressionEntry` table and the send window. Then it inserts `AudienceSnapshot`, a `CampaignRecipient` per VALID member, a `Message` per recipient (`idempotency_key = MessageKey.For(...)`; `processing_state='QUEUED'`, `handoff_state='NOT_HANDED_OFF'`, `delivery_state='NOT_REPORTED'`, `data_quality='CURRENT'`), `MessageContent` with the rendered text, and an `OutboxMessage('dispatch.sms', message_id)`. Finally it sets campaign state `RELEASED`.

- [ ] **Step 1: Write failing flow tests** (use the same XLSX fixture as Task 4, uploaded through the API):

```csharp
public class CampaignFlowTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact] public async Task Full_flow_creates_one_message_and_outbox_row_per_valid_recipient()
    {
        var dana = await f.LoginAs("dana"); var meir = await f.LoginAs("meir");
        var imp = await dana.UploadImport(Fixtures.XlsxBytes(), "הורי גנים.xlsx", new { idColumn = "ת.ז", nameColumn = "שם הורה", phoneColumn = "טל נייד הורה", variableColumns = new[] { "שם ילד", "גן" } });
        var camp = await dana.CreateCampaign("הזנה — נובמבר");
        await dana.PatchDraft(camp, new { audienceVersionId = imp.AudienceVersionId, channel = "SMS", contentText = "שלום {שם הורה}, תזכורת עבור {שם ילד}.", fieldDefaults = new Dictionary<string,string> { ["שם ילד"] = "ילדכם" } });
        var hash = await dana.Submit(camp);
        await meir.Approve(camp, hash);
        var rel = await meir.Release(camp);
        Assert.Equal(imp.ValidCount, rel.MessagesCreated);
        Assert.Equal(imp.ValidCount, await f.Db.ScalarAsync<int>($"SELECT COUNT(*) FROM OutboxMessage o JOIN Message m ON m.message_id = o.aggregate_id WHERE m.campaign_id = '{camp}'"));
    }

    [Fact] public async Task Creator_cannot_approve_own_campaign_above_threshold() { /* seed TenantPolicy.self_approval_max_recipients = 1, dana submits and approves → 403 SELF_APPROVAL_ABOVE_THRESHOLD */ }

    [Fact] public async Task Draft_change_after_submit_invalidates_approval_and_blocks_release() { /* submit, approve, PATCH contentText → approvalInvalidated=true, release → 409 APPROVAL_INVALID */ }

    [Fact] public async Task Missing_field_without_default_blocks_submit() { /* content uses {שם ילד} without default; fixture has a row with an empty child name → submit 422 PREFLIGHT_BLOCKED with MISSING_FIELD */ }

    [Fact] public async Task Suppressed_destination_is_not_sent() { /* insert SuppressionEntry for one normalized phone before release → messagesCreated = valid - 1, suppressed = 1 */ }

    [Fact] public async Task Releasing_twice_does_not_duplicate_messages() { /* second release with a new Idempotency-Key → 409 (state RELEASED) and Message count unchanged */ }
}
```

The implementer writes the bodies of the commented tests exactly as their comments describe, using the `ApiFactory` helpers (add `UploadImport`, `CreateCampaign`, `PatchDraft`, `Submit`, `Approve`, `Release`).

- [ ] **Step 2: Run, expect FAIL.** Then **Step 3: Implement.** Then **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**: `git commit -m "feat(api): import, campaign draft/preflight/submit/approve/release with server-side safety checks"`

---

### Task 7: Worker — Outbox dispatcher, MockSmsAdapter, provider events, tracking read model

**Files:**
- Create: `src/backend/ResidentComms.Worker/` (worker service; references Infrastructure), `Dispatch/OutboxDispatcher.cs`, `Providers/ISmsAdapter.cs`, `Providers/MockSmsAdapter.cs`
- Create: `src/backend/ResidentComms.Infrastructure/Events/ProviderEventProcessor.cs`
- Create: `src/backend/ResidentComms.Api/Endpoints/ProviderEventEndpoints.cs`, `TrackingEndpoints.cs`
- Test: `src/backend/tests/ResidentComms.Api.Tests/DispatchAndEventsTests.cs`

**Interfaces (produces):**
- `interface ISmsAdapter { Task<SendOutcome> SendAsync(SmsSendRequest r, CancellationToken ct); }`, with `record SmsSendRequest(Guid MessageId, string To, string Text, string IdempotencyKey)` and `record SendOutcome(string Kind /*ACCEPTED|REJECTED|AMBIGUOUS*/, string? ProviderMessageId, string? ErrorCode)`.
- `MockSmsAdapter` options: `AcceptRate` (0.9), `RejectRate` (0.02), `TimeoutRate` (0.03), `DeliverRate` (0.85 of accepted), `FailRate` (0.03 of accepted), `DuplicateEventRate` (0.05), `MaxEventDelaySeconds` (20) and `Seed` (deterministic in tests). On ACCEPTED it schedules mock events (`sent`, then `delivered` or `failed`, sometimes duplicated or out of order) by posting to `/v1/provider-events/mock-sms` with an HMAC-SHA256 signature header `X-Mock-Signature` over the body, keyed by `Providers:MockSms:SigningKey`.
- `OutboxDispatcher` (BackgroundService, polls every second):
  - Claims a batch with `UPDATE TOP(50) ... SET locked_until = now+30s OUTPUT ... WHERE processed_at IS NULL AND available_at <= now AND (locked_until IS NULL OR locked_until < now)`.
  - For each claimed row it inserts a `SendAttempt` (`attempt_number` = max+1), sets `processing_state = 'IN_PROGRESS'` and `handoff_state = 'HANDED_OFF'`, and calls the adapter.
  - ACCEPTED: handoff `ACCEPTED` and `provider_message_id` set.
  - REJECTED: handoff `REJECTED`.
  - AMBIGUOUS: handoff `UNKNOWN` and `acceptance_ambiguous = 1`, with **no** retry.
  - Every outcome sets `processed_at`.
- `POST /v1/provider-events/mock-sms` (anonymous, signature-verified):
  - An invalid signature returns `401` and writes nothing.
  - A valid one is stored in `MessageEvent` with `deduplication_key = "mock:" + providerEventId`. A duplicate returns `200` and creates no new fact.
  - Then `DeliveryMerge.Apply(current, incoming, message.delivery_conflict)` runs, and on conflict sets `delivery_conflict = 1` and `data_quality = 'CONFLICTING'`.
  - A `read` event with no matching message is stored with `message_id = NULL` and `correlation_quality = 'UNATTRIBUTED'`.
- `GET /v1/campaigns/{id}/tracking` returns:

```json
{ "environment": "sandbox-mock", "dataAsOf": "...", "messages": 3180,
  "delivery": { "delivered": 0, "sentOrNotReported": 0, "unknown": 0, "failed": 0 },
  "handoff": { "accepted": 0, "rejected": 0, "unknown": 0, "notHandedOff": 0 },
  "kpis": [ { "key": "accepted", "value": 0, "numerator": 0, "denominator": 3180 },
            { "key": "operationalDeliveryRate", "value": 0.0, "numerator": 0, "denominator": 0 } ],
  "bannerHe": "{accepted} הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.",
  "exceptions": [ { "messageId": "...", "recipientMasked": "050-***-**12", "displayStatus": "Unknown", "displayLabelHe": "לא ידוע", "lastAttempt": "ניסיון 1 · Timeout", "nextActionHe": "בירור" } ] }
```

  The display label comes from `DisplayStatusDeriver`. The operational rate's denominator is messages handed off (handoff ≠ NOT_HANDED_OFF), and pending and unknown stay in it. When the denominator is 0, `value` is `null`.

- [ ] **Step 1: Write failing tests** (run the dispatcher in-process with `MockSmsAdapter` seeded, and post events directly):

```csharp
public class DispatchAndEventsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact] public async Task Timeout_marks_unknown_and_is_never_retried_automatically() { /* adapter forced AMBIGUOUS for one message → handoff UNKNOWN, acceptance_ambiguous=1, OutboxMessage.processed_at set, SendAttempt count = 1 after running the dispatcher 3 more cycles */ }

    [Fact] public async Task Late_sent_after_delivered_does_not_lower_state() { /* post delivered then sent → delivery_state stays DELIVERED */ }

    [Fact] public async Task Duplicate_event_creates_one_fact() { /* post the same providerEventId twice → one MessageEvent row */ }

    [Fact] public async Task Delivered_then_failed_is_sticky_conflict() { /* → delivery_state UNKNOWN, delivery_conflict=1; then a later delivered keeps UNKNOWN */ }

    [Fact] public async Task Bad_signature_is_rejected_and_not_stored() { /* 401, no MessageEvent row */ }

    [Fact] public async Task Tracking_matches_truth_book_counts()
    {
        // Seed 5 messages for 3 recipients exactly as docs/qa/truth-book-01.md (states set directly via SQL),
        // then GET tracking → messages 5, delivered 2, failed 1, unknown 1, sentOrNotReported 1,
        // operationalDeliveryRate numerator 2 / denominator 5 (all handed off).
    }
}
```

The implementer writes the bodies exactly as commented.

- [ ] **Step 2: Run, expect FAIL.** Then **Step 3: Implement.** Then **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**: `git commit -m "feat(worker): outbox dispatcher, mock SMS adapter, signed provider events, tracking read model"`

---

### Task 8: Frontend foundation — Angular workspace, tokens, UI components

**Files:**
- Create: the Angular workspace in `src/frontend/` (`ng new resident-comms --directory . --style=css --routing --ssr=false`, keeping `design/`), `scripts/build-tokens.mjs`, `src/styles/tokens.css` (generated), `src/styles.css`
- Create: `src/app/ui/{button,status-badge,channel-chip,step-item,preflight-item,kpi-card,grid-row,banner,text-field,file-dropzone,app-shell}/`

**Interfaces (produces):**
- `node scripts/build-tokens.mjs` reads `design/tokens.json` and writes `src/styles/tokens.css`:
  - `:root` holds `--color-<path with / → ->>` for every color, `--space-*`, `--radius-*`, `--shadow-<effect>`, and `--font-family: "Rubik", system-ui, sans-serif`.
  - Density variables `--row-height`, `--row-padding-x`, `--row-padding-y` and `--control-height` from the comfortable set, plus a `[data-density="compact"]` block with the compact values.
  - A `.t-<text key>` utility class per text style, with `font-variant-numeric: tabular-nums` when `tabular` is true.
  - The script is idempotent. Add an npm script `"tokens": "node scripts/build-tokens.mjs"` that runs before `start` and `build`.
- `index.html`: `<html lang="he" dir="rtl">`, Rubik loaded from Google Fonts.
- Components (standalone, `ChangeDetectionStrategy.OnPush`, signal inputs). Variant names match Figma:
  - `<rc-button variant="primary|secondary|ghost|danger" [disabled] [disabledReason]>`. Primary uses `--color-bg-brand` and `--color-text-on-action`, with hover `--color-bg-brand-hover`. Focus is `--shadow-focus-ring` on `:focus-visible`. When `disabledReason` is set it renders a visually hidden reason linked with `aria-describedby`.
  - `<rc-status-badge [status]="DisplayStatus" [label]>`, with the 13 statuses and their groups from `docs/status-dictionary.md`. It always shows an icon and text. `Unknown` gets a dashed `--color-status-unknown-border` outline.
  - `<rc-channel-chip channel="SMS|WHATSAPP|EMAIL">`
  - `<rc-step-item state="done|current|pending|blocked|invalidated|skipped" [index] [label] [hint]>`. Current sets `aria-current="step"`.
  - `<rc-preflight-item kind="blocker|warning|passed" [title] [meta] [actionLabel] (action)>`
  - `<rc-kpi-card kind="count|rate|unknown" [title] [value] [definition] [dataAsOf]>`. A null value renders "לא ניתן לחישוב".
  - `<rc-grid-row [density] [selected]>` with content projection for cells. The start side is the right edge.
  - `<rc-banner kind="info|warning|danger|unknown|success" [message] [actionLabel]>`. Danger uses `role="alert"`; the others use `role="status"`.
  - `<rc-text-field [label] [helper] [error]>` with a projected input. The error is linked by `aria-describedby`.
  - `<rc-file-dropzone accept=".xlsx,.csv" (file)>`. It has a keyboard-accessible "בחרו קובץ" button, which is the alternative to dragging.
  - `<rc-app-shell [activeNav]>`. The sidebar is on the right at 258px with the nav items from spec §2 and a permanent "משלוח חדש" button. It has a top search area and a user chip. Below 1100px it collapses to an 88px icon rail. A "Sandbox (מדומה)" tag sits in the top bar.
- Icons: one `rc-icon` component with inline SVG paths copied from the Figma icon set (the same 24px stroke icons). Strokes use `currentColor`.

- [ ] **Step 1: Write failing component tests** (with whatever test runner `ng new` sets up), for example:

```ts
describe('StatusBadge', () => {
  it('renders icon and Hebrew label for every status and marks unknown with a dashed outline', async () => {
    const f = TestBed.createComponent(StatusBadgeComponent);
    f.componentRef.setInput('status', 'Unknown'); f.componentRef.setInput('label', 'לא ידוע'); f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('.badge');
    expect(el.textContent).toContain('לא ידוע');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.classList).toContain('badge--unknown');
  });
});
describe('Button', () => {
  it('exposes disabled reason to assistive tech', () => {
    const f = TestBed.createComponent(ButtonComponent);
    f.componentRef.setInput('disabled', true); f.componentRef.setInput('disabledReason', 'המשלוח אושר'); f.detectChanges();
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.disabled).toBe(true);
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)?.textContent).toContain('המשלוח אושר');
  });
});
describe('KpiCard', () => {
  it('shows "לא ניתן לחישוב" when value is null', () => { /* setInput value null → text contains "לא ניתן לחישוב" */ });
});
describe('build-tokens', () => {
  it('emits on-action and density variables', () => { /* run the script into a temp file and assert it contains "--color-text-on-action: #002538" and "[data-density=\"compact\"]" */ });
});
```

- [ ] **Step 2: Run, expect FAIL.** Then **Step 3: Implement.** Then **Step 4: Run, expect PASS**, and `npm run build` succeeds.
- [ ] **Step 5: Add a `/__ui` route** (Development only) that renders every component in every variant. It serves as a visual check against Figma page 02. Take one screenshot and compare it with the Figma screenshot of `02 Components` (Button, StatusBadge, ChannelChip, KpiCard).
- [ ] **Step 6: Commit**: `git commit -m "feat(frontend): Angular workspace, Figma tokens → CSS, Muni UI components"`

---

### Task 9: Frontend features — login, home, campaigns, wizard (SMS), approvals, tracking

**Files:**
- Create: `src/app/core/{api.client.ts, auth.service.ts, auth.guard.ts, idempotency.interceptor.ts}`, `proxy.conf.json` (`/v1` and `/health` → `http://localhost:5080`)
- Create: `src/app/features/{login, home, campaigns/list, campaigns/wizard, campaigns/tracking, approvals}/`

**Interfaces (consumes):** the API contracts from Tasks 5–7.

**Behavior and acceptance:**
- **Login:** picks one of the `/v1/dev/users`. The token is kept in `sessionStorage`. The interceptor adds the bearer token, plus `Idempotency-Key: crypto.randomUUID()` on POST, PUT and PATCH. The same key is reused when the same user action is retried, such as a double click or a network retry, so the key is generated per action and not per HTTP attempt.
- **Home (S01):** greeting banner (gradient `#13737D` under the text → `#0FA3B1`, white text, subtitle in `t-lead-24`), four quick-action cards, a task list from `GET /v1/approvals` and drafts, and recent campaigns from `GET /v1/campaigns`.
- **Campaign list (S02):** rows with name, purpose, channel chip, state and per-axis counts with "נכון ל-".
- **Wizard** (S10, S11, S12, S14, S15; the documents step shows as `skipped` "לא נדרש"):
  - Stepper built from `rc-step-item`.
  - Sticky summary on the start side with audience, channel, segments and estimated cost, plus a blockers box.
  - One primary action per step. Draft autosave on step change via PATCH, with the "נשמר אוטומטית · HH:mm" text.
  - **S10:** dropzone, mapping selects for the four columns, then the import result counts and an errors list link.
  - **S11:** SMS card selected. WhatsApp and Email cards are disabled with the tag "M2".
  - **S12:** textarea, field chips inserted from the mapped variable columns, a live segment counter from preflight, a preview with the first valid recipient (masked), and default values for missing fields.
  - **S14:** preflight findings as `rc-preflight-item`. Each "תקן" link navigates to its step.
  - **S15:** binding summary text and schedule (immediate or a datetime). The creator's button reads "הגשה לאישור · {N} הודעות".
- **Approvals (S30):** a list, and on selection the same preview as S12 plus the binding summary. The primary button reads exactly "אישור ושליחת {N} הודעות" and calls approve, then release. Server error codes map to Hebrew messages:
  - `SELF_APPROVAL_ABOVE_THRESHOLD` → "לא ניתן לאשר משלוח שיצרת מעל 1,000 נמענים"
  - `STALE_REVISION` → "המשלוח השתנה מאז ההגשה — נדרשת בדיקה מחדש"
  - `APPROVAL_INVALID` → "האישור אינו תקף לגרסה הנוכחית"
  - `OUTSIDE_SEND_WINDOW` → "מחוץ לחלון השעות — תזמנו לשעה מותרת"
- **Tracking (S17):**
  - Polls `GET /tracking` every 5s while the page is visible.
  - Shows the success banner using `bannerHe` verbatim, a stacked delivery bar with a numeric legend, KPI cards (accepted, operational rate, failed, unknown), and an exceptions table with `rc-status-badge` from `displayStatus`.
  - The page title area shows "Sandbox (מדומה)".
  - An `aria-live="polite"` region announces a summary at most every 30s.

- [ ] **Step 1: Write failing tests**: unit tests for `idempotency.interceptor` (adds the header on POST, not GET; reuses the key on retry of the same action), `auth.guard`, and the error-code → Hebrew mapping.
- [ ] **Step 2: Run, expect FAIL.** Then **Step 3: Implement.** Then **Step 4: Run, expect PASS**, and `npm run build` succeeds.
- [ ] **Step 5: Commit**: `git commit -m "feat(frontend): login, home, campaigns list, SMS wizard, approvals, tracking"`

---

### Task 10: End-to-end — Playwright flow, truth-book check, README, deploy prep

**Files:**
- Create: `src/frontend/e2e/m1-flow.spec.ts`, `src/frontend/playwright.config.ts`, `scripts/dev-up.ps1`
- Modify: `README.md`, `wrangler.jsonc` (comment only; it stays on `./public` until API hosting is decided)

- [ ] **Step 1: Write the Playwright test.**
  - Start the API (Development, test database via the env var `ConnectionStrings__Main`) and the Worker with a seeded mock adapter, plus `ng serve`.
  - Log in as דנה, upload a generated XLSX of 12 rows (2 invalid), complete S10 through S15, and submit.
  - Log in as מאיר, approve and send. Assert the button text was exactly "אישור ושליחת 10 הודעות".
  - Open tracking and wait until `delivered + failed + unknown + sentOrNotReported == 10`.
  - Assert the banner text matches `/^\d+ הודעות התקבלו אצל הספק\. תוצאות המסירה ממשיכות להתעדכן\.$/` and the "Sandbox (מדומה)" tag is visible.
  - Assert keyboard-only completion of S10's primary action (Tab to "בחרו קובץ", Enter) works.
- [ ] **Step 2: Run** `npx playwright test`. Expect PASS.
- [ ] **Step 3: Write `scripts/dev-up.ps1`:** it runs DbMigrator (`--database whatsapp --seed-dev`), then starts the API on 5080, the Worker and `npm start`. It checks that the `Auth:DevSigningKey` and `Providers:MockSms:SigningKey` user-secrets exist and prints how to set them if not.
- [ ] **Step 4: Update the README.** Add a "Run M1 locally" section: prerequisites (SQL Server localhost, .NET 10, Node 24), user-secrets setup, `scripts/dev-up.ps1`, test commands, and the note that everything is Sandbox (mock) with synthetic data only.
- [ ] **Step 5: Run the full verification:** `dotnet test src/backend/ResidentComms.slnx`, then `npm test` and `npm run build` in `src/frontend`, then `npx playwright test`, then `sqlcmd -S localhost -E -C -Q "select count(*) from sys.databases where name like 'ResidentComms_Test_%'"` (expect 0). Record the outputs in the PR description.
- [ ] **Step 6: Commit**: `git commit -m "test(e2e): M1 flow in Playwright, dev-up script, README run instructions"`

## Done criteria for M1

- The full flow works locally against the `whatsapp` database with the mock provider, visibly labelled Sandbox.
- These are enforced on the server and covered by tests: tenant from the token, idempotency, approval binding and invalidation, self-approval threshold, suppression and send window at release, no blind retry, event dedup and sticky conflict.
- The tracking numbers match truth book 01.
- All backend, frontend and e2e tests pass, and there are no leftover test databases.
- The README explains the local run. No secrets are in the repo.
- Cloudflare still serves the placeholder until the API hosting ADR (P8).
