# Figma Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new Figma file with the full 15-page Blueprint from spec §17, styled 100% in the Muni visual language.

**Architecture:** Work bottom-up. Foundations (variables) come first, then components with all their states, then patterns and the app shell, then screens assembled only from those components. Every screen uses synthetic data, and column names come from `docs/catalog/field-catalog.v1.json` (data-contracts plan, Task 5).

**Tech Stack:** The Figma remote MCP (`use_figma`, `create_new_file`, `get_design_context`, `get_screenshot`, `get_variable_defs`, `search_design_system`).

**Spec:** `docs/superpowers/specs/2026-11-17-resident-messaging-design.md` §3, and `RESIDENT_COMMUNICATION_SPEC.md` §2, §3, §4, §9, §11 and §17.

**Requires:** data-contracts plan Tasks 5–6 merged. They produce `docs/catalog/field-catalog.v1.json`, `docs/status-dictionary.md` and `docs/qa/truth-book-01.md`, which Tasks 3, 5 and 7 here read. Tasks 1–2 can start before that.

## Global Constraints

- **Required skills.** Load `figma:figma-use` before any `use_figma` call. Load `figma:figma-create-new-file` before `create_new_file`. Load `figma:figma-generate-design` for every screen task.
- **Visual source.** File key `AAeujWMg573IfqGDCYfZsY`, node `535:11252` (Muni DashboardLayout). Brand action color `#07BED1`. Match it 100% (ADR-002).
- **Status colors are a separate set** from brand and channel colors. StatusBadge always shows color, icon and text.
- **Channel colors:** WhatsApp green, SMS purple and Email orange, taken from the Muni pastel card palette.
- **Layout:** RTL throughout. Base frame 1440px wide; also check 1280 and 1024. Spacing tokens 4/8/12/16/24/32. Densities Comfortable and Compact.
- **Mandatory micro-copy** (spec §3): "2,846 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן." · "טרם התקבל אישור מסירה." · "אישור ושליחת 3,180 הודעות".
- **Data:** synthetic only, with a fictional council named "מועצה אזורית דוגמה". No real names or phones. Masked destinations look like `050-***-**12`.
- **Future screens:** anything in phases 2–3 (full PDF Studio, JSON Mapper, natural-language analytics) gets a visible tag "עתידי — שלב 2" or "עתידי — שלב 3".
- **Checkpoint rule:** after Tasks 2, 4 and 8, stop and show the user screenshots. Continue only on their OK.

---

### Task 1: Create the file and extract the Muni tokens

**Interfaces:**
- Produces: a new Figma file "מערכת תקשורת לתושבים — Blueprint" with 15 pages named exactly as in spec §17 (`00 Readme & Decisions` … `14 Handoff`). The file key is recorded in `docs/figma.md`.

- [ ] **Step 1:** Load `figma:figma-create-new-file`, then create the design file.
- [ ] **Step 2:** Load `figma:figma-use`. Create the 15 pages in order: `00 Readme & Decisions`, `01 Foundations`, `02 Components`, `03 Patterns`, `04 App Shell`, `05 Campaign Journey`, `06 Audiences & Import`, `07 Templates`, `08 PDF Studio`, `09 Data 360 & Analytics`, `10 Operations`, `11 Admin`, `12 Prototypes`, `13 Accessibility & RTL`, `14 Handoff`.
- [ ] **Step 3:** Call `get_design_context` and `get_variable_defs` on `AAeujWMg573IfqGDCYfZsY` / `535:11252`. From them, record the exact font family and weights, text sizes, corner radii, card shadow, background color, sidebar width (258px), the active nav item style and the four pastel card colors with their icon-tile colors.
- [ ] **Step 4:** Write `docs/figma.md` with the new file URL and key, plus a table of every extracted Muni value (name → value → source node id).
- [ ] **Step 5:** Commit: `git add docs/figma.md && git commit -m "docs: record Figma blueprint file and extracted Muni tokens"`

### Task 2: 01 Foundations — variables and styles

- [ ] **Step 1:** Create variable collections:
  - `color/brand`: primary `#07BED1`, its hover/pressed shades and the gradient stops from the Muni banner.
  - `color/surface`: page background, card, border and divider.
  - `color/text`: primary, secondary and disabled.
  - `color/channel`: whatsapp, sms and email, each with a bg tint and a fg.
  - `color/status`: one bg/fg/icon set per status *group*, chosen to stay distinct from brand and channel colors. The groups are: neutral (ממתין, בתור, בוטל), progress (הועבר לספק, התקבל אצל הספק, נשלח לפי הספק), success (נמסר), info (נקרא, נפתח), danger (נכשל, נדחה, נפסל לפני שליחה) and **unknown** (לא ידוע). Unknown gets its own hatched/outlined style so it never reads as success or failure.
  - `space`: 4, 8, 12, 16, 24 and 32.
  - `radius`: values from Task 1.
  - `density`: Comfortable and Compact modes, covering row height and padding.
- [ ] **Step 2:** Create text styles from the Muni font and sizes, including a tabular-figures style for IDs, counts and money. Create effect styles for the card shadow and the focus ring (a 2px brand ring with offset). Define the layers Base, Sticky, Drawer, Modal and Toast as a documented elevation scale.
- [ ] **Step 3:** On the `01 Foundations` page, lay out swatches, the type ramp, spacing, radii, shadows, the focus ring, and an RTL/LTR sample showing a Hebrew sentence with an isolated phone number, email and ID.
- [ ] **Step 4:** Verify with `get_screenshot` of the page and check against the Muni screenshot. Colors and type must match.
- [ ] **Step 5: Checkpoint 0.** Send the user the Foundations screenshot next to the Muni screenshot. Wait for their OK before Task 3. A wrong font or color is cheapest to fix here.

### Task 3: 02 Components — core components with all states

Every component is a component set whose variants cover: Default, Hover, Focus, Disabled-with-reason, Loading, Empty, Error, No permission, Partial data, Stale data, Conflict, Success, long Hebrew text and mixed RTL/LTR. Drop a variant only when it does not apply, and write why in the component description.

- [ ] **Step 1: Shell and navigation.** `AppShell` is the Muni sidebar on the right with logo, nav items, an active state, a divider and a logout item at the bottom, plus a top search bar and a "משלוח חדש" primary button. `StepNavigator` has 7 logical steps with step 4 conditional, showing done, current, blocked and invalidated states.
- [ ] **Step 2: Status.** `StatusBadge` has 13 variants, each with color, icon and Hebrew text from `docs/status-dictionary.md`. `UnknownExplanation` is a popover that explains "לא ידוע" and what it does not mean.
- [ ] **Step 3: Audience.** `SourcePicker`, `FileDropzone`, `FieldMapper` (a mapping row with a confidence chip), `ValidationSummary` (disjoint categories with counts) and `AudienceDiff` (added, removed, changed, lost eligibility, changed destination).
- [ ] **Step 4: Channels and content.** `ChannelCoverageCard` uses the Muni pastel card in the channel color and shows text like "71% זמינים ב-WhatsApp" plus the coverage basis (verified, computed or missing). `MessageEditor` takes `PersonalizationToken` chips. `SmsSegmentCounter` shows "70 תווים / 67 למקטע — לאימות מול הספק". `ChannelPreview` has WhatsApp, SMS and Email variants. `CostEstimate` is labeled "אומדן".
- [ ] **Step 5: Check and approval.** `DocumentMatchSummary`, `PreflightChecklist` (blockers vs warnings, each with a "תקן" link back to its step) and `ApprovalPanel` (plain-language summary, hash, approver note, primary button "אישור ושליחת {N} הודעות").
- [ ] **Step 6: Data.** `DataGrid` has a Comfortable mode as Muni-style card rows and a Compact mode as a dense table. The freeze column sits on the start side in RTL, and 0, empty and "לא ידוע" are rendered differently. Also `ColumnPicker` (groups and search), `FilterBuilder`, `SavedViewPicker`, `MessageDrawer` with tabs for summary, timeline, content, attempts, documents, replies, billing and data quality, `Timeline` and `ExportJobPanel`.
- [ ] **Step 7: Templates, documents and AI.** `TemplateLifecycle` keeps two histories: internal and provider. `JsonMapperTree` and `PdfCanvas` with Layers and Properties are tagged "עתידי — שלב 2". `AiSuggestion` shows its source and a dismiss action.
- [ ] **Step 8:** Verify with `get_screenshot` of `02 Components`. Every component instance must reference variables and never use hard-coded hex values. Check this with `use_figma` by scanning fills for missing bound variables.

### Task 4: 03 Patterns, 04 App Shell and checkpoint 1

- [ ] **Step 1:** In `03 Patterns`, build the patterns: the wizard page layout (a sticky summary of audience, channels, documents and cost estimate, a blockers list, one primary action, autosave status), empty states, error banners, the toast, the confirm dialog that separates "ניתן לביטול", "כבר הועבר" and "תוצאה לא ידועה", and the "השפעת שינוי" notice ("השינוי משפיע על 4 משלוחים מתוזמנים ו-2,140 הודעות").
- [ ] **Step 2:** In `04 App Shell`, build the shell at 1440, 1280 and 1024 widths with the full nav: בית · משלוחים · קהלים ומקורות · תבניות · מסמכים · דוחות ונתונים · חריגים · ניהול.
- [ ] **Step 3: Checkpoint.** Send the user screenshots of Foundations, Components (StatusBadge, ChannelCoverageCard, DataGrid) and the App Shell. Wait for their OK before Task 5.

### Task 5: 05 Campaign Journey (S01, S02, S10–S17, S30)

Load `figma:figma-generate-design`. Build each screen only from Task 3 components.

- [ ] **Step 1: S01 Home.** Two variants: new user and active user. The Muni greeting banner says "בוקר טוב, {שם}". Four pastel quick-action cards: משלוח חדש · ייבוא קובץ · תבנית חדשה · דוחות. The left panel replaces "העוזר האישי" with tasks: 3 drafts to complete, 2 waiting for your approval, 1 campaign with unusual failures, 4 documents without a match, a template whose state changed, and "סנכרון אחרון: 10:42". No charts.
- [ ] **Step 2: S02 Campaign list.** Muni card rows showing name, purpose, channels, state, counts by axis and "נכון ל-".
- [ ] **Step 3: S10 Who.** Saved group, upload, approved source or single recipient. Counts: records, unique, eligible per channel, invalid, duplicates, excluded by reason and source freshness.
- [ ] **Step 4: S11 How.** Channel coverage cards, single channel as the default, a parallel option, and a primary-plus-fallback option that is off by default and tagged "שלב 2".
- [ ] **Step 5: S12 What.** An editor per channel, template picker, token chips, SMS segment counter, and a live preview with a masked real recipient.
- [ ] **Step 6: S13 Documents (conditional).** Template, delivery mode (secure link recommended), match summary and exceptions.
- [ ] **Step 7: S14 Check.** Preflight blockers and warnings from spec §4, edge-case previews, cost and a test send marked TEST.
- [ ] **Step 8: S15 Approve and send.** The binding summary, schedule and the button "אישור ושליחת 3,180 הודעות".
- [ ] **Step 9: S16 Going back.** Shows the invalidation banner "שינית את הקהל; יש לבדוק מחדש 126 מסמכים" and the approval marked invalid.
- [ ] **Step 10: S17 Tracking.** Progress and counters per axis with "לא ידוע" always visible, the micro-copy "2,846 הודעות התקבלו אצל הספק. תוצאות המסירה ממשיכות להתעדכן.", exceptions, data freshness, and actions: pause, stop remainder, controlled retry, export. Use the numbers from `docs/qa/truth-book-01.md` scaled up.
- [ ] **Step 11: S30 Approvals inbox.** The approver sees the same preview the creator saw.
- [ ] **Step 12:** Verify with `get_screenshot` of every screen. The micro-copy must be exact and every StatusBadge must have an icon and text.

### Task 6: 06 Audiences & Import (S20–S23) and 07 Templates (S60)

- [ ] **Step 1: S20 Upload.** Drag or choose a file, security scan, encoding detection (including Windows-1255), sheet picker, header row and preview.
- [ ] **Step 2: S21 Mapping.** Auto-suggestions with a confidence level, "שמור כתבנית מיפוי", and a structure-fingerprint suggestion.
- [ ] **Step 3: S22 Errors.** Disjoint categories, leading zeros lost and scientific notation flagged, plus "ייצא שגיאות".
- [ ] **Step 4: S23 Diff.** Added, removed, changed, lost eligibility, changed destination. Modes: replace, add or upsert.
- [ ] **Step 5: S60 Template library and lifecycle.** States: טיוטה · הוגשה · בבדיקה · מאושרת · נדחתה · הושהתה · הושבתה · לא ידוע. The two histories appear side by side. Show "זוהה ב-10:15; מועד השינוי אצל הספק לא נמסר" and "המעקב החל בתאריך…", with affected scheduled campaigns listed.

### Task 7: 08 PDF Studio (S70–S72) and 09 Data 360 & Analytics (S40–S44, S50, S51, S90)

- [ ] **Step 1: S72 Document matching.** Phase 1: recipient ↔ data ↔ document. A mismatch blocks.
- [ ] **Step 2: S70 JSON Mapper and S71 PDF Studio.** Three-zone mapper; canvas with Layers and Properties. Tag both "עתידי — שלב 2" and keep them to one representative screen each.
- [ ] **Step 3: S40 Campaign 360 and S41 Message 360.** Grid with a default of up to 10 columns, read from the catalog (`grain` = "Message 360"): מצב · נמען ממוסך · ערוץ · משלוח · תבנית · ניסיון אחרון · מסירה · חריג · מסמכים · פעולה הבאה. "בחר הכול" distinguishes the current page from all filtered results.
- [ ] **Step 4: S42 Message drawer, S43 Attempts and S44 Events.** The drawer opens without losing filters. Events show occurred, received and processed times, with unattributed replies shown as "לא משויכת".
- [ ] **Step 5: S50 Column picker and saved views, and S51 Export.** Export is async with an expiring link and a "PII לא נכלל — אין הרשאה" state.
- [ ] **Step 6: S90 Natural-language analytics.** Tagged "עתידי — שלב 3". The example answer splits "לא נמסרו" into four groups: נכשלו, נדחו, ממתינות and ללא אישור מסירה.

### Task 8: 10 Operations, 11 Admin (S80–S82) and checkpoint 2

- [ ] **Step 1: 10 Operations dashboard.** Queue depth, rate, ambiguous acceptances, unattributed events, webhook lag, failed documents, changed templates and unsynced connectors. Every card shows its definition, numerator, denominator and freshness, and links to rows.
- [ ] **Step 2: S80 Sources, S81 Permissions and S82 Audit.** Permissions combine role with attributes. PII exposure and export are shown as separate permissions. The audit log is read-only.
- [ ] **Step 3: Checkpoint.** Send the user screenshots of pages 05–11 and wait for their OK.

### Task 9: 00 Readme, 12 Prototypes, 13 Accessibility & RTL and 14 Handoff

- [ ] **Step 1: 00 Readme & Decisions.** Purpose, links to the spec, design doc and ADRs, decisions D1–D7, and a legend for the "עתידי" tags.
- [ ] **Step 2: 12 Prototypes.** Wire clickable flows in priority order from spec §17:
  - (1) Excel → SMS to 3,000 → check → approve → track.
  - (2) Import fix with broken phones.
  - (3) Audience change after approval.
  - (4) Timeout → "לא ידוע" → reconciliation → allowed retry.
  - (5) Analyst builds a view and exports.
- [ ] **Step 3: 13 Accessibility & RTL.** Focus order per wizard step, a keyboard alternative for every drag, errors linked to their fields, the grid keyboard spec, and a paginated alternative for the virtual table.
- [ ] **Step 4: 14 Handoff.** One handoff card per core component covering purpose, anatomy, variants, keyboard, RTL rules, error states and catalog fields.
- [ ] **Step 5:** Update `docs/figma.md` with page links, then commit: `git add docs/figma.md && git commit -m "docs: link completed Figma blueprint pages"`

## Done criteria for this plan

- All 15 pages exist, and every screen listed in spec §17 is present or explicitly tagged future.
- Every fill and text style is bound to a variable or style. A scan finds no hard-coded hex values on screens.
- The user approved checkpoints 1 and 2.
- `docs/figma.md` links the file and its pages.
