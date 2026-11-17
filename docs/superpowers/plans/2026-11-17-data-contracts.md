# Data Contracts (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay down the data contracts the whole system depends on: the status axes and display-status derivation, the core SQL Server schema with its safety constraints, the field catalog as JSON, and a QA truth book. All of it is proven by tests.

**Architecture:** A .NET 10 class library (`ResidentComms.Domain`) holds pure domain logic with xUnit tests. Plain T-SQL migration scripts live in `db/migrations`, and an integration-test project runs them against a throwaway database on a local SQL Server. A Node script builds the field catalog from §12 of the spec, and `node --test` verifies it. There are no workers, providers or UI in this plan.

**Tech Stack:** .NET 10 SDK (10.0.401 installed), C#, xUnit, Microsoft.Data.SqlClient, SQL Server 2025 on `localhost` (Windows auth; needs `TrustServerCertificate=true`), Node 24 (`node:test`).

**Spec:** `docs/superpowers/specs/2026-11-17-resident-messaging-design.md`, which implements `RESIDENT_COMMUNICATION_SPEC.md` §8, §9, §12, §15, §18 and §21.

## Global Constraints

- `tenant_id` on every table; never accepted from the client as truth (spec §15).
- IDs, phones and national IDs are stored as strings; raw and normalized values are kept separately (spec §5).
- All timestamps are UTC (`DATETIME2(3)`); display is Asia/Jerusalem (spec §16).
- Missing information is "לא ידוע", never success and never failure (spec §1).
- A late "sent" never lowers a "delivered" state (spec §9).
- Retry is a new SendAttempt, not a new Message. Fallback is a new Message with `parent_message_id` (spec §21.3).
- Documents are counted as `COUNT DISTINCT document_id`, never as link rows (spec §8).
- `MessageEvent` is append-only (spec §8, §15).
- No secrets or real resident data in the repo, because it is public (design D5).
- Integration tests create and drop their own database named `ResidentComms_Test_<guid>`. Never touch other databases on the server.

## File Structure

```text
src/backend/ResidentComms.slnx
src/backend/ResidentComms.Domain/ResidentComms.Domain.csproj
src/backend/ResidentComms.Domain/Status/Axes.cs              ← 5 axis enums + MessageAxes record
src/backend/ResidentComms.Domain/Status/DisplayStatus.cs     ← 13 display states + Hebrew labels
src/backend/ResidentComms.Domain/Status/DisplayStatusDeriver.cs
src/backend/ResidentComms.Domain/Status/DeliveryMerge.cs     ← monotonic delivery-state merge
src/backend/ResidentComms.Domain/Counting/CampaignCounter.cs ← counting rules
src/backend/tests/ResidentComms.Domain.Tests/...             ← unit tests
src/backend/tests/ResidentComms.Db.Tests/...                 ← schema integration tests
db/migrations/V001__core_schema.sql
db/migrations/V002__idempotency.sql
tools/catalog/build-catalog.mjs
tools/catalog/build-catalog.test.mjs
docs/catalog/field-catalog.v1.json                           ← generated
docs/status-dictionary.md
docs/qa/truth-book-01.md
docs/adr/ADR-001-technology.md
docs/adr/ADR-002-muni-visual-language.md
docs/adr/ADR-003-product-placement-open.md
.gitignore
README.md
```

---

### Task 1: Solution scaffold and ADRs

**Files:**
- Create: `.gitignore`, `README.md`, `docs/adr/ADR-001-technology.md`, `docs/adr/ADR-002-muni-visual-language.md`, `docs/adr/ADR-003-product-placement-open.md`
- Create: `src/backend/ResidentComms.slnx`, `src/backend/ResidentComms.Domain/`, `src/backend/tests/ResidentComms.Domain.Tests/`

**Interfaces:**
- Produces: the projects `ResidentComms.Domain` (namespace root `ResidentComms.Domain`) and `ResidentComms.Domain.Tests`, both in the solution.

- [ ] **Step 1: Create the solution and projects**

Run from the repo root:
```bash
cd src/backend
dotnet new sln -n ResidentComms
dotnet new classlib -n ResidentComms.Domain -o ResidentComms.Domain -f net10.0
dotnet new xunit -n ResidentComms.Domain.Tests -o tests/ResidentComms.Domain.Tests -f net10.0
dotnet add tests/ResidentComms.Domain.Tests reference ResidentComms.Domain
dotnet sln add ResidentComms.Domain tests/ResidentComms.Domain.Tests
rm ResidentComms.Domain/Class1.cs tests/ResidentComms.Domain.Tests/UnitTest1.cs
```

- [ ] **Step 2: Verify that it builds**

Run: `dotnet build src/backend/ResidentComms.slnx`
Expected: `Build succeeded`, 0 errors.

- [ ] **Step 3: Write `.gitignore`**

```gitignore
bin/
obj/
.vs/
*.user
node_modules/
TestResults/
```

- [ ] **Step 4: Write the ADRs**

`docs/adr/ADR-001-technology.md`:
```markdown
# ADR-001 — טכנולוגיה

- מצב: התקבל, 17.11.2026
- הקשר: האפיון אינו בוחר טכנולוגיה (הנחיה 2).
- החלטה: Angular ל-Frontend, C# / ASP.NET Core (.NET 10) ל-Backend, SQL Server למסד. מיגרציות כ-T-SQL גולמי ב-`db/migrations`.
- נימוק: בחירת המשתמש, תואם לצוות ולתשתית הרשויות (SQL Server on-prem).
- השלכות: חוזי נתונים נכתבים ל-SQL Server. בדיקות אינטגרציה רצות מול SQL Server מקומי.
```

`docs/adr/ADR-002-muni-visual-language.md`:
```markdown
# ADR-002 — שפה עיצובית Muni

- מצב: התקבל, 17.11.2026
- הקשר: סעיף 3 באפיון מבקש "זהות עצמאית, לא חיקוי".
- החלטה: **שינוי מהאפיון** — העיצוב תואם 100% לשפת Muni (קובץ Figma "חינוך", node 535:11252): טורקיז #07BED1, כרטיסים מעוגלים, סרגל צד, hugeicons.
- נשמר מסעיף 3: צבעי סטטוס נפרדים מהמותג ותמיד עם אייקון וטקסט, RTL מהיסוד, מיקרו־קופי מחייב, ללא אנימציה דקורטיבית בפעולות קריטיות.
```

`docs/adr/ADR-003-product-placement-open.md`:
```markdown
# ADR-003 — מיקום המוצר: החלטה פתוחה

- מצב: פתוח, 17.11.2026
- שאלה: מודול בפלטפורמת Muni/המועצה (IdentityService, CommsGatewayService) או מוצר עצמאי.
- עד ההחלטה: זיהוי משתמשים ומשלוח לספקים מוגדרים מאחורי ממשקים, כך שהחלפת מימוש לא תשנה את מודל הנתונים. המעטפת בעיצוב מתאימה לשני המצבים.
- הערה: CommsGatewayService בגרסתו הנוכחית תומך SMS ו-Email בלבד, ללא WhatsApp.
```

- [ ] **Step 5: Write `README.md`**

```markdown
# מערכת תקשורת רב־ערוצית לתושבים

- אפיון: [RESIDENT_COMMUNICATION_SPEC.md](RESIDENT_COMMUNICATION_SPEC.md)
- עיצוב: [docs/superpowers/specs](docs/superpowers/specs)
- החלטות: [docs/adr](docs/adr)

## הרצה

    dotnet test src/backend/ResidentComms.slnx
    node --test tools/catalog/build-catalog.test.mjs

בדיקות המסד דורשות SQL Server מקומי. מחרוזת חיבור ברירת מחדל:
`Server=localhost;Integrated Security=true;TrustServerCertificate=true`.
אפשר לשנות דרך משתנה הסביבה `RESIDENTCOMMS_SQL`.

מצב: שלב 0 — חוזי נתונים בלבד. אין Workers, ספקים או ממשק משתמש. כל הנתונים סינתטיים.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md docs/adr src/backend
git commit -m "chore: scaffold .NET solution and record ADRs 001-003"
```

---

### Task 2: Status axes and display-status derivation

**Files:**
- Create: `src/backend/ResidentComms.Domain/Status/Axes.cs`
- Create: `src/backend/ResidentComms.Domain/Status/DisplayStatus.cs`
- Create: `src/backend/ResidentComms.Domain/Status/DisplayStatusDeriver.cs`
- Test: `src/backend/tests/ResidentComms.Domain.Tests/Status/DisplayStatusDeriverTests.cs`

**Interfaces:**
- Produces:
  - `enum ProcessingState { RejectedBeforeSend, Pending, Queued, InProgress, Canceled }`
  - `enum HandoffState { NotHandedOff, HandedOff, Accepted, Rejected, Unknown }`
  - `enum DeliveryState { NotReported, SentPerProvider, Delivered, Failed, Unknown }`
  - `enum DataQuality { Current, Partial, Late, Conflicting, Unsupported }`
  - `record InteractionFlags(DateTimeOffset? ReadAt, OpenedAt, ClickedAt, RepliedAt, OptedOutAt)`
  - `record MessageAxes(ProcessingState Processing, HandoffState Handoff, DeliveryState Delivery, InteractionFlags Interaction, DataQuality Quality)`
  - `enum DisplayStatus` with 13 values
  - `static string DisplayStatusLabels.He(DisplayStatus)`
  - `static DisplayStatus DisplayStatusDeriver.Derive(MessageAxes axes)`

- [ ] **Step 1: Write the failing tests**

```csharp
using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Status;

public class DisplayStatusDeriverTests
{
    private static MessageAxes Axes(
        ProcessingState p = ProcessingState.InProgress,
        HandoffState h = HandoffState.NotHandedOff,
        DeliveryState d = DeliveryState.NotReported,
        InteractionFlags? i = null) =>
        new(p, h, d, i ?? new InteractionFlags(), DataQuality.Current);

    [Fact]
    public void Rejected_before_send_wins_over_everything()
        => Assert.Equal(DisplayStatus.RejectedBeforeSend,
            DisplayStatusDeriver.Derive(Axes(p: ProcessingState.RejectedBeforeSend)));

    [Fact]
    public void Canceled_before_handoff_is_canceled()
        => Assert.Equal(DisplayStatus.Canceled,
            DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Canceled)));

    [Fact]
    public void Pending_and_queued_map_to_their_labels()
    {
        Assert.Equal(DisplayStatus.Pending, DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Pending)));
        Assert.Equal(DisplayStatus.Queued, DisplayStatusDeriver.Derive(Axes(p: ProcessingState.Queued)));
    }

    [Fact]
    public void Handed_off_without_answer_is_handed_off_not_accepted()
        => Assert.Equal(DisplayStatus.HandedOff,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.HandedOff)));

    [Fact]
    public void Accepted_without_delivery_report_is_accepted_by_provider()
        => Assert.Equal(DisplayStatus.AcceptedByProvider,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted)));

    [Fact]
    public void Timeout_after_handoff_is_unknown_not_failed()
        => Assert.Equal(DisplayStatus.Unknown,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Unknown)));

    [Fact]
    public void Unknown_delivery_is_unknown()
        => Assert.Equal(DisplayStatus.Unknown,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Unknown)));

    [Fact]
    public void Provider_rejection_is_rejected()
        => Assert.Equal(DisplayStatus.Rejected,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Rejected)));

    [Fact]
    public void Failure_report_is_failed()
        => Assert.Equal(DisplayStatus.Failed,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Failed)));

    [Fact]
    public void Sent_and_delivered_map_to_their_labels()
    {
        Assert.Equal(DisplayStatus.SentPerProvider,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.SentPerProvider)));
        Assert.Equal(DisplayStatus.Delivered,
            DisplayStatusDeriver.Derive(Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered)));
    }

    [Fact]
    public void Read_flag_shows_read_and_open_flag_shows_opened()
    {
        var t = DateTimeOffset.Parse("2026-11-17T08:00:00Z");
        Assert.Equal(DisplayStatus.Read, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered, i: new InteractionFlags(ReadAt: t))));
        Assert.Equal(DisplayStatus.Opened, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Delivered, i: new InteractionFlags(OpenedAt: t))));
    }

    [Fact]
    public void Failed_wins_over_interaction_flags()
    {
        var t = DateTimeOffset.Parse("2026-11-17T08:00:00Z");
        Assert.Equal(DisplayStatus.Failed, DisplayStatusDeriver.Derive(
            Axes(h: HandoffState.Accepted, d: DeliveryState.Failed, i: new InteractionFlags(ReadAt: t))));
    }

    [Fact]
    public void Every_display_status_has_a_hebrew_label()
    {
        foreach (var s in Enum.GetValues<DisplayStatus>())
            Assert.False(string.IsNullOrWhiteSpace(DisplayStatusLabels.He(s)));
        Assert.Equal(13, Enum.GetValues<DisplayStatus>().Length);
    }
}
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: a build error. `MessageAxes`, `DisplayStatusDeriver` and the other types do not exist yet.

- [ ] **Step 3: Write `Axes.cs`**

```csharp
namespace ResidentComms.Domain.Status;

/// <summary>Internal processing axis (spec §9).</summary>
public enum ProcessingState { RejectedBeforeSend, Pending, Queued, InProgress, Canceled }

/// <summary>Hand-off-to-provider axis. Unknown = request may have reached the provider but no answer.</summary>
public enum HandoffState { NotHandedOff, HandedOff, Accepted, Rejected, Unknown }

/// <summary>Delivery axis. NotReported is not failure.</summary>
public enum DeliveryState { NotReported, SentPerProvider, Delivered, Failed, Unknown }

/// <summary>Information-quality axis.</summary>
public enum DataQuality { Current, Partial, Late, Conflicting, Unsupported }

/// <summary>Interaction flags with timestamps. A null flag means "no event", never "did not happen".</summary>
public sealed record InteractionFlags(
    DateTimeOffset? ReadAt = null,
    DateTimeOffset? OpenedAt = null,
    DateTimeOffset? ClickedAt = null,
    DateTimeOffset? RepliedAt = null,
    DateTimeOffset? OptedOutAt = null);

public sealed record MessageAxes(
    ProcessingState Processing,
    HandoffState Handoff,
    DeliveryState Delivery,
    InteractionFlags Interaction,
    DataQuality Quality);
```

- [ ] **Step 4: Write `DisplayStatus.cs`**

```csharp
namespace ResidentComms.Domain.Status;

/// <summary>The 13 display labels (spec §9). Presentation helper only; never replaces the axes.</summary>
public enum DisplayStatus
{
    RejectedBeforeSend, Pending, Queued, HandedOff, AcceptedByProvider, SentPerProvider,
    Delivered, Read, Opened, Failed, Rejected, Canceled, Unknown
}

public static class DisplayStatusLabels
{
    public static string He(DisplayStatus status) => status switch
    {
        DisplayStatus.RejectedBeforeSend => "נפסל לפני שליחה",
        DisplayStatus.Pending => "ממתין",
        DisplayStatus.Queued => "בתור",
        DisplayStatus.HandedOff => "הועבר לספק",
        DisplayStatus.AcceptedByProvider => "התקבל אצל הספק",
        DisplayStatus.SentPerProvider => "נשלח לפי הספק",
        DisplayStatus.Delivered => "נמסר",
        DisplayStatus.Read => "נקרא",
        DisplayStatus.Opened => "נפתח",
        DisplayStatus.Failed => "נכשל",
        DisplayStatus.Rejected => "נדחה",
        DisplayStatus.Canceled => "בוטל",
        DisplayStatus.Unknown => "לא ידוע",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };
}
```

- [ ] **Step 5: Write `DisplayStatusDeriver.cs`**

```csharp
namespace ResidentComms.Domain.Status;

/// <summary>
/// Derives the single display label from the five axes. The order below is the contract;
/// it is documented in docs/status-dictionary.md and must stay in sync with it.
/// </summary>
public static class DisplayStatusDeriver
{
    public static DisplayStatus Derive(MessageAxes a)
    {
        if (a.Processing == ProcessingState.RejectedBeforeSend) return DisplayStatus.RejectedBeforeSend;
        if (a.Processing == ProcessingState.Canceled && a.Handoff == HandoffState.NotHandedOff)
            return DisplayStatus.Canceled;
        if (a.Delivery == DeliveryState.Failed) return DisplayStatus.Failed;
        if (a.Handoff == HandoffState.Rejected) return DisplayStatus.Rejected;
        if (a.Interaction.ReadAt is not null) return DisplayStatus.Read;
        if (a.Interaction.OpenedAt is not null) return DisplayStatus.Opened;
        if (a.Delivery == DeliveryState.Delivered) return DisplayStatus.Delivered;
        if (a.Delivery == DeliveryState.SentPerProvider) return DisplayStatus.SentPerProvider;
        if (a.Delivery == DeliveryState.Unknown || a.Handoff == HandoffState.Unknown) return DisplayStatus.Unknown;
        if (a.Handoff == HandoffState.Accepted) return DisplayStatus.AcceptedByProvider;
        if (a.Handoff == HandoffState.HandedOff) return DisplayStatus.HandedOff;
        if (a.Processing is ProcessingState.Queued or ProcessingState.InProgress) return DisplayStatus.Queued;
        return DisplayStatus.Pending;
    }
}
```

- [ ] **Step 6: Run the tests to verify that they pass**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: all 13 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/backend
git commit -m "feat(domain): status axes and 13-state display derivation"
```

---

### Task 3: Monotonic delivery-state merge

**Files:**
- Create: `src/backend/ResidentComms.Domain/Status/DeliveryMerge.cs`
- Test: `src/backend/tests/ResidentComms.Domain.Tests/Status/DeliveryMergeTests.cs`

**Interfaces:**
- Consumes: `DeliveryState` (Task 2).
- Produces: `readonly record struct DeliveryMergeResult(DeliveryState State, bool Conflict)` and `static DeliveryMergeResult DeliveryMerge.Apply(DeliveryState current, DeliveryState incoming)`.

- [ ] **Step 1: Write the failing tests**

```csharp
using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Status;

public class DeliveryMergeTests
{
    [Fact]
    public void Late_sent_after_delivered_does_not_regress()
        => Assert.Equal(new DeliveryMergeResult(DeliveryState.Delivered, false),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.SentPerProvider));

    [Fact]
    public void Sent_progresses_to_delivered_or_failed()
    {
        Assert.Equal(DeliveryState.Delivered, DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.Delivered).State);
        Assert.Equal(DeliveryState.Failed, DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.Failed).State);
    }

    [Fact]
    public void Duplicate_event_changes_nothing()
        => Assert.Equal(new DeliveryMergeResult(DeliveryState.Delivered, false),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.Delivered));

    [Fact]
    public void Definite_result_replaces_unknown()
        => Assert.Equal(DeliveryState.Delivered,
            DeliveryMerge.Apply(DeliveryState.Unknown, DeliveryState.Delivered).State);

    [Fact]
    public void Unknown_never_overwrites_a_definite_result()
        => Assert.Equal(DeliveryState.Failed,
            DeliveryMerge.Apply(DeliveryState.Failed, DeliveryState.Unknown).State);

    [Fact]
    public void NotReported_incoming_is_ignored()
        => Assert.Equal(DeliveryState.SentPerProvider,
            DeliveryMerge.Apply(DeliveryState.SentPerProvider, DeliveryState.NotReported).State);

    [Fact]
    public void Delivered_versus_failed_is_flagged_as_conflict_and_unknown()
    {
        Assert.Equal(new DeliveryMergeResult(DeliveryState.Unknown, true),
            DeliveryMerge.Apply(DeliveryState.Delivered, DeliveryState.Failed));
        Assert.Equal(new DeliveryMergeResult(DeliveryState.Unknown, true),
            DeliveryMerge.Apply(DeliveryState.Failed, DeliveryState.Delivered));
    }
}
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: a build error. `DeliveryMerge` does not exist yet.

- [ ] **Step 3: Write `DeliveryMerge.cs`**

```csharp
namespace ResidentComms.Domain.Status;

public readonly record struct DeliveryMergeResult(DeliveryState State, bool Conflict);

/// <summary>
/// Merges an incoming delivery report into the current state by channel rules, not by arrival order
/// (spec §9). Contradicting definite results become Unknown with Conflict=true — no invented certainty.
/// The caller sets DataQuality.Conflicting and keeps every raw event.
/// </summary>
public static class DeliveryMerge
{
    public static DeliveryMergeResult Apply(DeliveryState current, DeliveryState incoming)
    {
        if (current == incoming || incoming == DeliveryState.NotReported) return new(current, false);
        if (current is DeliveryState.NotReported or DeliveryState.Unknown) return new(incoming, false);
        if (incoming == DeliveryState.Unknown) return new(current, false);
        if (current == DeliveryState.SentPerProvider) return new(incoming, false);
        if (incoming == DeliveryState.SentPerProvider) return new(current, false);
        return new(DeliveryState.Unknown, true); // Delivered vs Failed
    }
}
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: all tests pass (20 in total).

- [ ] **Step 5: Commit**

```bash
git add src/backend
git commit -m "feat(domain): monotonic delivery merge with conflict flag"
```

---

### Task 4: Core SQL Server schema and constraint tests

**Files:**
- Create: `db/migrations/V001__core_schema.sql`
- Create: `db/migrations/V002__idempotency.sql`
- Create: `src/backend/tests/ResidentComms.Db.Tests/ResidentComms.Db.Tests.csproj`
- Create: `src/backend/tests/ResidentComms.Db.Tests/TestDatabase.cs`
- Test: `src/backend/tests/ResidentComms.Db.Tests/SchemaConstraintTests.cs`

**Interfaces:**
- Produces: tables `Tenant, Audience, AudienceVersion, AudienceSnapshot, Campaign, CampaignRevision, Approval, CampaignRecipient, Message, SendAttempt, MessageEvent, Document, MessageDocumentLink, IdempotencyRecord`, and the stored procedure `dbo.usp_ClaimIdempotencyKey(@TenantId, @OperationType, @Key, @RequestHash, @Outcome OUTPUT)`, where outcome 0 = new, 1 = replay and 2 = conflict.
- Produces: the test fixture `TestDatabase : IAsyncLifetime` with `SqlConnection Open()` and `Task<int> Exec(string sql)`.

- [ ] **Step 1: Create the test project**

```bash
cd src/backend
dotnet new xunit -n ResidentComms.Db.Tests -o tests/ResidentComms.Db.Tests -f net10.0
dotnet add tests/ResidentComms.Db.Tests package Microsoft.Data.SqlClient
dotnet sln add tests/ResidentComms.Db.Tests
rm tests/ResidentComms.Db.Tests/UnitTest1.cs
```

- [ ] **Step 2: Write the fixture `TestDatabase.cs`**

```csharp
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace ResidentComms.Db.Tests;

/// <summary>Creates ResidentComms_Test_&lt;guid&gt;, applies db/migrations in order, drops it afterwards.</summary>
public sealed class TestDatabase : IAsyncLifetime
{
    private static readonly string ServerCs =
        Environment.GetEnvironmentVariable("RESIDENTCOMMS_SQL")
        ?? "Server=localhost;Integrated Security=true;TrustServerCertificate=true";

    public string Name { get; } = $"ResidentComms_Test_{Guid.NewGuid():N}";
    private string DbCs => new SqlConnectionStringBuilder(ServerCs) { InitialCatalog = Name }.ConnectionString;

    public async Task InitializeAsync()
    {
        await using (var master = new SqlConnection(ServerCs))
        {
            await master.OpenAsync();
            await new SqlCommand($"CREATE DATABASE [{Name}]", master).ExecuteNonQueryAsync();
        }
        var dir = FindMigrationsDir();
        foreach (var file in Directory.GetFiles(dir, "V*.sql").Order())
            foreach (var batch in Regex.Split(await File.ReadAllTextAsync(file), @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
                if (!string.IsNullOrWhiteSpace(batch)) await Exec(batch);
    }

    public async Task DisposeAsync()
    {
        SqlConnection.ClearAllPools();
        await using var master = new SqlConnection(ServerCs);
        await master.OpenAsync();
        await new SqlCommand($"ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}]", master).ExecuteNonQueryAsync();
    }

    public SqlConnection Open()
    {
        var c = new SqlConnection(DbCs);
        c.Open();
        return c;
    }

    public async Task<int> Exec(string sql)
    {
        await using var c = Open();
        return await new SqlCommand(sql, c).ExecuteNonQueryAsync();
    }

    private static string FindMigrationsDir()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !Directory.Exists(Path.Combine(d.FullName, "db", "migrations"))) d = d.Parent;
        return d is null ? throw new DirectoryNotFoundException("db/migrations not found") : Path.Combine(d.FullName, "db", "migrations");
    }
}
```

- [ ] **Step 3: Write the failing tests `SchemaConstraintTests.cs`**

```csharp
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
        var (_, c, r, cr) = await SeedAsync();
        var other = Guid.NewGuid();
        await db.Exec($"INSERT Tenant(tenant_id, name) VALUES ('{other}', N'רשות אחרת')");
        await Assert.ThrowsAsync<SqlException>(() => InsertMessage(other, c, r, cr, "SMS", 1, $"k-{Guid.NewGuid()}"));
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
}
```

- [ ] **Step 4: Run the tests to verify that they fail**

Run: `dotnet test src/backend/tests/ResidentComms.Db.Tests`
Expected: every test FAILs with "db/migrations not found" or "Invalid object name 'Tenant'".

- [ ] **Step 5: Write `db/migrations/V001__core_schema.sql`**

```sql
-- V001: core entities (spec §8). tenant_id on every table. All times UTC.
CREATE TABLE Tenant (
    tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Audience (
    audience_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    name NVARCHAR(200) NOT NULL,
    audience_kind VARCHAR(20) NOT NULL CHECK (audience_kind IN ('FILE','SQL','API','SAVED_FILTER','REUSABLE')),
    owner_id VARCHAR(100) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Audience_Tenant UNIQUE (tenant_id, audience_id)
);

CREATE TABLE AudienceVersion (
    audience_version_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_id UNIQUEIDENTIFIER NOT NULL,
    version_no INT NOT NULL,
    source_loaded_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AudienceVersion UNIQUE (tenant_id, audience_id, version_no),
    CONSTRAINT UQ_AudienceVersion_Tenant UNIQUE (tenant_id, audience_version_id),
    CONSTRAINT FK_AudienceVersion_Audience FOREIGN KEY (tenant_id, audience_id) REFERENCES Audience(tenant_id, audience_id)
);

-- Immutable once created (created at approval).
CREATE TABLE AudienceSnapshot (
    audience_snapshot_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    frozen_at DATETIME2(3) NOT NULL,
    CONSTRAINT UQ_AudienceSnapshot_Tenant UNIQUE (tenant_id, audience_snapshot_id),
    CONSTRAINT FK_AudienceSnapshot_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);
-- Tenant isolation in the data layer (spec §15): every child FK is composite (tenant_id, parent_id),
-- so a row can never reference a parent of another tenant.

CREATE TABLE Campaign (
    campaign_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    department_id VARCHAR(50) NOT NULL,
    campaign_name NVARCHAR(200) NOT NULL,
    campaign_description NVARCHAR(2000) NULL,
    campaign_type VARCHAR(20) NOT NULL CHECK (campaign_type IN ('MANUAL','SCHEDULED','API','EVENT','CHILD')),
    communication_purpose VARCHAR(20) NOT NULL CHECK (communication_purpose IN ('SERVICE','OPERATIONAL','PUBLIC_INFO','EMERGENCY','PROMOTIONAL')),
    campaign_state VARCHAR(30) NOT NULL,
    parent_campaign_id UNIQUEIDENTIFIER NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Campaign_Tenant UNIQUE (tenant_id, campaign_id),
    CONSTRAINT FK_Campaign_Parent FOREIGN KEY (tenant_id, parent_campaign_id) REFERENCES Campaign(tenant_id, campaign_id)
);

CREATE TABLE CampaignRevision (
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    revision_no INT NOT NULL,
    audience_snapshot_id UNIQUEIDENTIFIER NULL,
    approval_package_hash CHAR(64) NULL,           -- canonical hash: audience + content + documents + channels + schedule + policy version
    scheduled_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_CampaignRevision UNIQUE (tenant_id, campaign_id, revision_no),
    CONSTRAINT UQ_CampaignRevision_Tenant UNIQUE (tenant_id, campaign_revision_id),
    CONSTRAINT FK_CampaignRevision_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_CampaignRevision_Snapshot FOREIGN KEY (tenant_id, audience_snapshot_id) REFERENCES AudienceSnapshot(tenant_id, audience_snapshot_id)
);

CREATE TABLE Approval (
    approval_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL,
    approval_package_hash CHAR(64) NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED','RETURNED')),
    decided_by VARCHAR(100) NOT NULL,
    decided_at DATETIME2(3) NOT NULL,
    invalidated_at DATETIME2(3) NULL,              -- set when a material change creates a new revision
    note NVARCHAR(2000) NULL,
    CONSTRAINT FK_Approval_Revision FOREIGN KEY (tenant_id, campaign_revision_id) REFERENCES CampaignRevision(tenant_id, campaign_revision_id)
);

-- One frozen recipient per snapshot. A re-approved audience creates a new snapshot holding the same people,
-- so uniqueness is per snapshot, not per campaign (spec §4, §21.2). Shared contact details never merge recipients (spec §0).
CREATE TABLE CampaignRecipient (
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    audience_snapshot_id UNIQUEIDENTIFIER NOT NULL,
    source_recipient_id NVARCHAR(100) NOT NULL,    -- string; leading zeros kept
    approved_identity_key NVARCHAR(200) NOT NULL,
    eligibility_state VARCHAR(30) NULL,
    primary_exclusion_reason VARCHAR(50) NULL,
    CONSTRAINT UQ_CampaignRecipient UNIQUE (tenant_id, audience_snapshot_id, approved_identity_key),
    CONSTRAINT UQ_CampaignRecipient_Tenant UNIQUE (tenant_id, campaign_recipient_id),
    CONSTRAINT FK_CampaignRecipient_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_CampaignRecipient_Snapshot FOREIGN KEY (tenant_id, audience_snapshot_id) REFERENCES AudienceSnapshot(tenant_id, audience_snapshot_id)
);

-- Logical message = recipient × channel × sequence step (spec §21.3).
CREATE TABLE Message (
    message_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL,
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL,
    parent_message_id UNIQUEIDENTIFIER NULL,       -- fallback only
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    channel_sequence_no INT NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    destination_raw NVARCHAR(320) NULL,
    destination_value NVARCHAR(320) NOT NULL,      -- E.164 or email
    template_id UNIQUEIDENTIFIER NULL,
    template_version VARCHAR(50) NULL,
    content_ref VARCHAR(400) NULL,                 -- encrypted reference, not content
    content_hash CHAR(64) NULL,
    provider_id VARCHAR(50) NULL,
    provider_message_id VARCHAR(200) NULL,
    provider_status_raw NVARCHAR(200) NULL,
    processing_state VARCHAR(25) NOT NULL CHECK (processing_state IN ('REJECTED_BEFORE_SEND','PENDING','QUEUED','IN_PROGRESS','CANCELED')),
    handoff_state VARCHAR(20) NOT NULL CHECK (handoff_state IN ('NOT_HANDED_OFF','HANDED_OFF','ACCEPTED','REJECTED','UNKNOWN')),
    delivery_state VARCHAR(20) NOT NULL CHECK (delivery_state IN ('NOT_REPORTED','SENT_PER_PROVIDER','DELIVERED','FAILED','UNKNOWN')),
    data_quality VARCHAR(15) NOT NULL CHECK (data_quality IN ('CURRENT','PARTIAL','LATE','CONFLICTING','UNSUPPORTED')),
    read_at DATETIME2(3) NULL, opened_at DATETIME2(3) NULL, clicked_at DATETIME2(3) NULL,
    replied_at DATETIME2(3) NULL, opted_out_at DATETIME2(3) NULL,
    status_mapping_version VARCHAR(50) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Message_Logical UNIQUE (tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no),
    CONSTRAINT UQ_Message_Idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT UQ_Message_Tenant UNIQUE (tenant_id, message_id),
    CONSTRAINT FK_Message_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_Message_Revision FOREIGN KEY (tenant_id, campaign_revision_id) REFERENCES CampaignRevision(tenant_id, campaign_revision_id),
    CONSTRAINT FK_Message_Recipient FOREIGN KEY (tenant_id, campaign_recipient_id) REFERENCES CampaignRecipient(tenant_id, campaign_recipient_id),
    CONSTRAINT FK_Message_Parent FOREIGN KEY (tenant_id, parent_message_id) REFERENCES Message(tenant_id, message_id)
);

-- Retry = new attempt, not new message.
CREATE TABLE SendAttempt (
    attempt_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NOT NULL,
    attempt_number INT NOT NULL,
    attempt_reason VARCHAR(20) NOT NULL CHECK (attempt_reason IN ('INITIAL','CONTROLLED_RETRY')),
    request_started_at DATETIME2(3) NOT NULL,
    response_received_at DATETIME2(3) NULL,
    attempt_outcome VARCHAR(20) NULL CHECK (attempt_outcome IN ('ACCEPTED','REJECTED','LOCAL_FAILURE','AMBIGUOUS')),
    acceptance_ambiguous BIT NOT NULL DEFAULT 0,
    provider_message_id VARCHAR(200) NULL,
    provider_response_code VARCHAR(50) NULL,
    provider_error_code VARCHAR(100) NULL,
    retry_not_before DATETIME2(3) NULL,
    CONSTRAINT UQ_SendAttempt UNIQUE (message_id, attempt_number),
    CONSTRAINT UQ_SendAttempt_Tenant UNIQUE (tenant_id, attempt_id),
    CONSTRAINT FK_SendAttempt_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id)
);

-- Append-only event log. message_id NULL = unattributed (never guessed).
CREATE TABLE MessageEvent (
    event_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NULL,
    attempt_id UNIQUEIDENTIFIER NULL,
    provider_event_id VARCHAR(200) NULL,
    deduplication_key VARCHAR(200) NOT NULL,
    event_type_raw NVARCHAR(200) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_source VARCHAR(20) NOT NULL CHECK (event_source IN ('WEBHOOK','POLLING','API','RECONCILIATION','INTERNAL')),
    occurred_at DATETIME2(3) NULL,                 -- never invented
    received_at DATETIME2(3) NOT NULL,
    processed_at DATETIME2(3) NOT NULL,
    signature_valid BIT NOT NULL,
    correlation_quality VARCHAR(20) NULL,
    payload_ref VARCHAR(400) NULL,
    CONSTRAINT UQ_MessageEvent_Dedup UNIQUE (tenant_id, deduplication_key),
    CONSTRAINT FK_MessageEvent_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id),
    CONSTRAINT FK_MessageEvent_Attempt FOREIGN KEY (tenant_id, attempt_id) REFERENCES SendAttempt(tenant_id, attempt_id)
);
GO

CREATE TRIGGER TR_MessageEvent_AppendOnly ON MessageEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 51000, 'MessageEvent is append-only.', 1;
END;
GO

-- Match key: tenant + campaign + campaign_recipient_id + document_key (spec §7).
CREATE TABLE Document (
    document_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL,
    document_key NVARCHAR(200) NOT NULL,
    document_template_id UNIQUEIDENTIFIER NULL,
    document_template_version VARCHAR(50) NULL,
    generation_state VARCHAR(20) NOT NULL CHECK (generation_state IN ('PLANNED','GENERATED','FAILED','PURGED')),
    recipient_match_state VARCHAR(20) NOT NULL CHECK (recipient_match_state IN ('UNCHECKED','MATCHED','UNMATCHED','AMBIGUOUS')),
    content_sha256 CHAR(64) NULL,
    generated_at DATETIME2(3) NULL,
    CONSTRAINT UQ_Document_Match UNIQUE (tenant_id, campaign_id, campaign_recipient_id, document_key),
    CONSTRAINT UQ_Document_Tenant UNIQUE (tenant_id, document_id),
    CONSTRAINT FK_Document_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_Document_Recipient FOREIGN KEY (tenant_id, campaign_recipient_id) REFERENCES CampaignRecipient(tenant_id, campaign_recipient_id)
);

CREATE TABLE MessageDocumentLink (
    message_document_link_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NOT NULL,
    document_id UNIQUEIDENTIFIER NOT NULL,
    delivery_mode VARCHAR(20) NOT NULL CHECK (delivery_mode IN ('ATTACHMENT','SECURE_LINK')),
    attachment_or_link_state VARCHAR(20) NOT NULL,
    link_expires_at DATETIME2(3) NULL,
    CONSTRAINT UQ_MessageDocumentLink UNIQUE (message_id, document_id),
    CONSTRAINT FK_Link_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id),
    CONSTRAINT FK_Link_Document FOREIGN KEY (tenant_id, document_id) REFERENCES Document(tenant_id, document_id)
);
GO
```

- [ ] **Step 6: Write `db/migrations/V002__idempotency.sql`**

```sql
-- V002: API idempotency (spec §21.4). Scope = tenant + operation type.
CREATE TABLE IdempotencyRecord (
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    operation_type VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    result_ref VARCHAR(400) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_IdempotencyRecord PRIMARY KEY (tenant_id, operation_type, idempotency_key)
);
GO

-- @Outcome: 0 = new claim, 1 = replay of the same request, 2 = conflict (same key, different request).
CREATE PROCEDURE dbo.usp_ClaimIdempotencyKey
    @TenantId UNIQUEIDENTIFIER,
    @OperationType VARCHAR(100),
    @Key VARCHAR(200),
    @RequestHash CHAR(64),
    @Outcome TINYINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT IdempotencyRecord(tenant_id, operation_type, idempotency_key, request_hash)
        VALUES (@TenantId, @OperationType, @Key, @RequestHash);
        SET @Outcome = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
        SELECT @Outcome = CASE WHEN request_hash = @RequestHash THEN 1 ELSE 2 END
        FROM IdempotencyRecord
        WHERE tenant_id = @TenantId AND operation_type = @OperationType AND idempotency_key = @Key;
    END CATCH
END;
GO
```

- [ ] **Step 7: Run the tests to verify that they pass**

Run: `dotnet test src/backend/tests/ResidentComms.Db.Tests`
Expected: all 9 tests pass. Then confirm that no `ResidentComms_Test_*` database remains:
`sqlcmd -S localhost -E -C -Q "select name from sys.databases where name like 'ResidentComms_Test_%'"` returns 0 rows.

- [ ] **Step 8: Commit**

```bash
git add db src/backend
git commit -m "feat(db): core schema with logical-message, idempotency, dedup and append-only constraints"
```

---

### Task 5: Field catalog JSON from spec §12

**Files:**
- Create: `tools/catalog/build-catalog.mjs`
- Test: `tools/catalog/build-catalog.test.mjs`
- Create (generated): `docs/catalog/field-catalog.v1.json`

**Interfaces:**
- Produces: `export function buildCatalog(specMarkdown: string): { version: string, sourceRowCount: number, fields: Field[] }`, where `Field` has exactly the 16 keys of spec §21.5 plus `row_id` (the source row number, e.g. `C01`).
- Produces: the file `docs/catalog/field-catalog.v1.json`. The Figma Grid screens (Plan B) read column names from it.

- [ ] **Step 1: Write the failing tests**

```js
// tools/catalog/build-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog, KEYS } from './build-catalog.mjs';

const spec = readFileSync(new URL('../../RESIDENT_COMMUNICATION_SPEC.md', import.meta.url), 'utf8');
const catalog = buildCatalog(spec);

test('reads all 262 source rows of §12', () => {
  assert.equal(catalog.sourceRowCount, 262);
});

test('every field has exactly the 16 properties of §21.5 plus row_id', () => {
  assert.equal(KEYS.length, 16);
  for (const f of catalog.fields) assert.deepEqual(Object.keys(f).sort(), [...KEYS, 'row_id'].sort());
});

test('rows with several technical names are split', () => {
  const i10 = catalog.fields.filter(f => f.row_id === 'I10').map(f => f.technical_name);
  assert.deepEqual(i10, ['phone_raw', 'phone_normalized']);
  const i15 = catalog.fields.filter(f => f.row_id === 'I15');
  assert.deepEqual(i15.map(f => f.data_type), ['id', 'int']);
});

test('grain + technical_name is unique', () => {
  const keys = catalog.fields.map(f => `${f.grain}|${f.technical_name}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('profile and access are expanded', () => {
  const m17 = catalog.fields.find(f => f.technical_name === 'destination_value');
  assert.equal(m17.grain, 'Message 360');
  assert.equal(m17.source_profile, 'SRC');
  assert.equal(m17.sensitivity, 'אישי');
  assert.equal(m17.priority, 'required');
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `node --test tools/catalog/build-catalog.test.mjs` (pass the file path: on Node 24, a bare directory argument does not find the tests)
Expected: FAIL with "Cannot find module ... build-catalog.mjs".

- [ ] **Step 3: Write `build-catalog.mjs`**

```js
// Builds the field catalog (spec §12, structure per §21.5) from the spec markdown.
// Usage: node tools/catalog/build-catalog.mjs  → writes docs/catalog/field-catalog.v1.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEYS = [
  'display_name_he', 'technical_name', 'description', 'data_type', 'priority', 'grain',
  'source_profile', 'value_origin', 'channels', 'availability_condition', 'missing_value_meaning',
  'sensitivity', 'view_permission', 'filter_policy', 'export_policy', 'calculation_or_notes',
];

// Copied from the §12 profile table.
const PROFILES = {
  SYS: ['מערכת או הזנת משתמש', 'כולם', 'הישות או השלב קיימים', 'טרם קרה / לא הוגדר'],
  SRC: ['Snapshot מקור הנתונים (ערך מנורמל בנפרד)', 'כולם', 'השדה מופה והותר', 'לא סופק / הושחר'],
  POL: ['מחושב לפי כלל בעל גרסה', 'כולם', 'בוצעה הערכה', 'טרם נבדק'],
  AGG: ['מחושב (נוסחה בהערה)', 'כולם', 'עובדות הבסיס זמינות', 'לא ניתן לחישוב (אינו אפס)'],
  PRV: ['ספק: API, Webhook, בירור', 'לפי תמיכת ספק', 'התקבל דיווח', 'לא דווח / לא נתמך / טרם התקבל'],
  WA: ['ספק WhatsApp', 'WhatsApp', 'התקבל אירוע נתמך', 'אין אירוע; לא הוכחה שלילית'],
  EM: ['ספק Email', 'Email', 'מעקב מותר ונתמך', 'לא נתמך / לא התקבל'],
  INT: ['קישורים עוקבים / הודעות נכנסות', 'ערוצים עם מעקב / קבלה', 'הופעל והתקבל אירוע משויך', 'אין אירוע / לא מופעל'],
  DOC: ['שירות מסמכים', 'כל ערוץ עם מסמך', 'הוגדר תהליך מסמך', 'לא נדרש / טרם הופק'],
  EST: ['מחושב ממחירון בעל גרסה', 'כולם', 'יחידות ומחיר ידועים', 'אין אומדן אמין'],
  BILL: ['נתוני חיוב ספק או הקצאה מסומנת', 'לפי ספק', 'התקבל חיוב שניתן לשייך', 'טרם דווח (אינו אפס)'],
};

// Copied from the §12 access table.
const ACCESS = {
  O: ['תפעולי', 'משתמש מורשה ברשות ובמחלקה', 'כן', 'בהרשאת ייצוא'],
  P: ['אישי', 'ממוסך כברירת מחדל; מלא בהרשאת PII', 'רק בהרשאת PII', 'הרשאת ייצוא אישי נפרדת'],
  S: ['רגיש / תוכן', 'הרשאת תוכן ייעודית, מתועדת', 'לא (או נתיב מאושר)', 'חסום כברירת מחדל'],
  A: ['טכני / מנהלי', 'תפעול טכני, ביקורת', 'כן', 'הרשאה טכנית'],
  F: ['כספי', 'הרשאת עלויות', 'כן', 'הרשאת ייצוא כספי'],
};

const PRIORITY = { 'ח': 'required', 'מ': 'recommended', 'ע': 'future' };
const MISSING_CODES = 'NOT_APPLICABLE, NOT_SUPPORTED, NOT_REPORTED, PENDING, REDACTED, PURGED, UNKNOWN';

export function buildCatalog(md) {
  const lines = md.split(/\r?\n/);
  const fields = [];
  let grain = null;
  let sourceRowCount = 0;

  for (const line of lines) {
    const h = line.match(/^### 12\.\d+\. (.+?) — /);
    if (h) { grain = h[1].trim(); continue; }
    if (/^## 13\./.test(line)) break;
    if (!grain) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 7 || !/^[A-Z]\d{2}$/.test(cells[0])) continue;

    sourceRowCount++;
    const [rowId, names, type, profile, access, prio, note] = cells;
    const [he, tech] = names.split(' — ').map(s => s.trim());
    const techNames = tech.split(',').map(s => s.trim());
    const types = type.split('/').map(s => s.trim());
    const p = PROFILES[profile];
    const a = ACCESS[access];
    if (!p || !a || !PRIORITY[prio]) throw new Error(`Unknown profile/access/priority in row ${rowId}`);

    techNames.forEach((technical_name, i) => {
      fields.push({
        row_id: rowId,
        display_name_he: he,
        technical_name,
        description: note || he,
        data_type: types[Math.min(i, types.length - 1)],
        priority: PRIORITY[prio],
        grain,
        source_profile: profile,
        value_origin: p[0],
        channels: p[1],
        availability_condition: p[2],
        missing_value_meaning: `${p[3]} · ${MISSING_CODES}`,
        sensitivity: a[0],
        view_permission: a[1],
        filter_policy: a[2],
        export_policy: a[3],
        calculation_or_notes: note,
      });
    });
  }
  return { version: '1.0.0', sourceRowCount, fields };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../../', import.meta.url);
  const catalog = buildCatalog(readFileSync(new URL('RESIDENT_COMMUNICATION_SPEC.md', root), 'utf8'));
  mkdirSync(new URL('docs/catalog/', root), { recursive: true });
  writeFileSync(new URL('docs/catalog/field-catalog.v1.json', root), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`source rows: ${catalog.sourceRowCount}, fields: ${catalog.fields.length}`);
}
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `node --test tools/catalog/build-catalog.test.mjs`
Expected: 5 tests pass. If the uniqueness test fails, print the duplicate `grain|technical_name` pairs. Don't silently dedupe them. Record each duplicate as a finding in `docs/catalog/README.md` and ask the user before changing anything. Spec §21.5 says identical names across views are not necessarily the same definition.

- [ ] **Step 5: Generate the JSON**

Run: `node tools/catalog/build-catalog.mjs`
Expected: `source rows: 262, fields: <N>`, where N > 262. The file `docs/catalog/field-catalog.v1.json` exists.

- [ ] **Step 6: Commit**

```bash
git add tools/catalog docs/catalog
git commit -m "feat(catalog): generate 16-property field catalog from spec §12"
```

---

### Task 6: Counting rules, status dictionary and truth book

**Files:**
- Create: `src/backend/ResidentComms.Domain/Counting/CampaignCounter.cs`
- Test: `src/backend/tests/ResidentComms.Domain.Tests/Counting/CampaignCounterTests.cs`
- Create: `docs/status-dictionary.md`, `docs/qa/truth-book-01.md`

**Interfaces:**
- Consumes: `DeliveryState` (Task 2).
- Produces:
  - `record MessageRow(Guid MessageId, Guid CampaignRecipientId, string Channel, DeliveryState Delivery)`
  - `record DocumentLinkRow(Guid DocumentId, Guid? MessageId)`
  - `record CampaignCounts(int Recipients, int Messages, int Documents, int Delivered, int Failed, int Unknown, int Pending, int ReachedRecipients)`
  - `static CampaignCounts CampaignCounter.Count(IReadOnlyCollection<MessageRow>, IReadOnlyCollection<DocumentLinkRow>)`

- [ ] **Step 1: Write `docs/qa/truth-book-01.md`**

```markdown
# ספר אמת 01 — משלוח קטן

כל מסך, ייצוא ומדד חייבים להתאים לטבלה הזו (סעיף 18).

| נמען | הודעה | ערוץ | מצב מסירה |
| --- | --- | --- | --- |
| R1 | M1 | WHATSAPP | DELIVERED |
| R1 | M2 | SMS | DELIVERED |
| R1 | M3 | EMAIL | NOT_REPORTED |
| R2 | M4 | SMS | FAILED |
| R3 | M5 | SMS | UNKNOWN |

מסמכים: D1 מקושר ל-M1, M2, M3. D2 מקושר ל-M1. D3 ל-M4. D4 טרם קושר.

| מדד | ערך צפוי | הסבר |
| --- | --- | --- |
| נמענים | 3 | R1 עם שלוש הודעות נספר פעם אחת |
| הודעות | 5 | |
| מסמכים | 4 | COUNT DISTINCT document_id — לא 6 שורות קישור |
| נמסרו | 2 | |
| נכשלו | 1 | |
| לא ידוע | 1 | |
| ממתינות (לא דווח) | 1 | נשאר במכנה; אינו כשל |
| נמענים שהושגו | 1 | רק R1 |
| שיעור מסירה תפעולי | 2/5 = 40% | ממתין ולא ידוע נשארים במכנה |
```

- [ ] **Step 2: Write the failing tests**

```csharp
using ResidentComms.Domain.Counting;
using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Tests.Counting;

public class CampaignCounterTests
{
    private static readonly Guid R1 = Guid.NewGuid(), R2 = Guid.NewGuid(), R3 = Guid.NewGuid();
    private static readonly Guid M1 = Guid.NewGuid(), M2 = Guid.NewGuid(), M3 = Guid.NewGuid(), M4 = Guid.NewGuid(), M5 = Guid.NewGuid();
    private static readonly Guid D1 = Guid.NewGuid(), D2 = Guid.NewGuid(), D3 = Guid.NewGuid(), D4 = Guid.NewGuid();

    [Fact]
    public void Truth_book_01_matches()
    {
        var messages = new[]
        {
            new MessageRow(M1, R1, "WHATSAPP", DeliveryState.Delivered),
            new MessageRow(M2, R1, "SMS", DeliveryState.Delivered),
            new MessageRow(M3, R1, "EMAIL", DeliveryState.NotReported),
            new MessageRow(M4, R2, "SMS", DeliveryState.Failed),
            new MessageRow(M5, R3, "SMS", DeliveryState.Unknown),
        };
        var docs = new[]
        {
            new DocumentLinkRow(D1, M1), new DocumentLinkRow(D1, M2), new DocumentLinkRow(D1, M3),
            new DocumentLinkRow(D2, M1), new DocumentLinkRow(D3, M4), new DocumentLinkRow(D4, null),
        };

        var c = CampaignCounter.Count(messages, docs);

        Assert.Equal(new CampaignCounts(Recipients: 3, Messages: 5, Documents: 4, Delivered: 2,
            Failed: 1, Unknown: 1, Pending: 1, ReachedRecipients: 1), c);
    }

    [Fact]
    public void One_recipient_three_channels_three_documents_each()
    {
        var msgs = new[] { M1, M2, M3 }.Select((m, i) =>
            new MessageRow(m, R1, new[] { "WHATSAPP", "SMS", "EMAIL" }[i], DeliveryState.Delivered)).ToArray();
        var docs = new[] { D1, D2, D3 }.SelectMany(d => msgs.Select(m => new DocumentLinkRow(d, m.MessageId))).ToArray();

        var c = CampaignCounter.Count(msgs, docs);

        Assert.Equal(1, c.Recipients);
        Assert.Equal(3, c.Messages);
        Assert.Equal(3, c.Documents);
    }
}
```

- [ ] **Step 3: Run the tests to verify that they fail**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: a build error. `CampaignCounter` does not exist yet.

- [ ] **Step 4: Write `CampaignCounter.cs`**

```csharp
using ResidentComms.Domain.Status;

namespace ResidentComms.Domain.Counting;

public sealed record MessageRow(Guid MessageId, Guid CampaignRecipientId, string Channel, DeliveryState Delivery);
public sealed record DocumentLinkRow(Guid DocumentId, Guid? MessageId);

public sealed record CampaignCounts(
    int Recipients, int Messages, int Documents, int Delivered,
    int Failed, int Unknown, int Pending, int ReachedRecipients);

/// <summary>
/// Counting rules (spec §8, §21.3): each child table is reduced to its own grain before counting.
/// Documents = COUNT DISTINCT document_id. NotReported is Pending, never Failed.
/// </summary>
public static class CampaignCounter
{
    public static CampaignCounts Count(IReadOnlyCollection<MessageRow> messages, IReadOnlyCollection<DocumentLinkRow> documentLinks)
    {
        var distinctMessages = messages.DistinctBy(m => m.MessageId).ToList();
        return new CampaignCounts(
            Recipients: distinctMessages.Select(m => m.CampaignRecipientId).Distinct().Count(),
            Messages: distinctMessages.Count,
            Documents: documentLinks.Select(d => d.DocumentId).Distinct().Count(),
            Delivered: distinctMessages.Count(m => m.Delivery == DeliveryState.Delivered),
            Failed: distinctMessages.Count(m => m.Delivery == DeliveryState.Failed),
            Unknown: distinctMessages.Count(m => m.Delivery == DeliveryState.Unknown),
            Pending: distinctMessages.Count(m => m.Delivery is DeliveryState.NotReported or DeliveryState.SentPerProvider),
            ReachedRecipients: distinctMessages.Where(m => m.Delivery == DeliveryState.Delivered)
                .Select(m => m.CampaignRecipientId).Distinct().Count());
    }
}
```

- [ ] **Step 5: Run the tests to verify that they pass**

Run: `dotnet test src/backend/ResidentComms.slnx`
Expected: all Domain tests pass (22). The Db tests also pass when SQL Server is running.

- [ ] **Step 6: Write `docs/status-dictionary.md`**

```markdown
# מילון סטטוסים

מקור: סעיף 9 באפיון. מימוש: `src/backend/ResidentComms.Domain/Status/`.

## חמשת הצירים

| ציר | ערכים (Enum) |
| --- | --- |
| תהליך פנימי — ProcessingState | RejectedBeforeSend · Pending · Queued · InProgress · Canceled |
| העברה לספק — HandoffState | NotHandedOff · HandedOff · Accepted · Rejected · Unknown |
| מסירה — DeliveryState | NotReported · SentPerProvider · Delivered · Failed · Unknown |
| אינטראקציה — InteractionFlags | ReadAt · OpenedAt · ClickedAt · RepliedAt · OptedOutAt |
| איכות מידע — DataQuality | Current · Partial · Late · Conflicting · Unsupported |

## גזירת התווית (סדר העדיפות הוא החוזה)

1. RejectedBeforeSend בציר התהליך ← **נפסל לפני שליחה**
2. Canceled לפני העברה לספק ← **בוטל**
3. Delivery = Failed ← **נכשל**
4. Handoff = Rejected ← **נדחה**
5. ReadAt קיים ← **נקרא**
6. OpenedAt קיים ← **נפתח**
7. Delivery = Delivered ← **נמסר**
8. Delivery = SentPerProvider ← **נשלח לפי הספק**
9. Delivery = Unknown או Handoff = Unknown ← **לא ידוע**
10. Handoff = Accepted ← **התקבל אצל הספק**
11. Handoff = HandedOff ← **הועבר לספק**
12. Queued / InProgress ← **בתור**
13. אחרת ← **ממתין**

הערה: ביטול אחרי העברה לספק מוצג לפי מצב הספק, כי אין הבטחה לבטל הודעה שהספק קיבל (סעיף 4).

## מיזוג מצב מסירה (DeliveryMerge)

- "נשלח" שמגיע אחרי "נמסר" אינו מוריד מצב.
- "לא ידוע" אינו דורס תוצאה מוכרעת; תוצאה מוכרעת מחליפה "לא ידוע".
- "נמסר" מול "נכשל" ← "לא ידוע" + דגל סתירה. הקורא מסמן DataQuality = Conflicting ושומר את כל האירועים הגולמיים.
- אירוע כפול אינו משנה מצב.

התווית היא עזר תצוגה בלבד. מדדים נספרים לפי הצירים, והמונים של צירים שונים עשויים לחפוף (סעיף 21.3).
```

- [ ] **Step 7: Commit**

```bash
git add src/backend docs/status-dictionary.md docs/qa
git commit -m "feat(domain): counting rules with truth book 01 and status dictionary"
```

---

## Done criteria for this plan

- `dotnet test src/backend/ResidentComms.slnx` passes: 22 Domain tests and 9 Db tests.
- `node --test tools/catalog/build-catalog.test.mjs` passes, and `docs/catalog/field-catalog.v1.json` has been generated.
- ADRs 001–003, the status dictionary and truth book 01 are committed.
- Nothing is pushed until the user asks.
