# HabitFlow — Product Requirements Document v4.0

**Security Hardened · Cloudflare Edge Stack · Timer Tracking · Calendar View**

| Field | Value |
|-------|-------|
| Version | 4.0 |
| Date | March 2026 |
| Authors | Lakshay (Product & Backend) + Claude (PM, Design & Security) |
| Status | **v4.0 Live** |

---

## 1. Executive Summary

### What is HabitFlow?

HabitFlow is a modern, mobile-first habit tracking web application built on Cloudflare's edge platform. It combines daily task tracking (binary and timed), visual analytics, and calendar-based navigation — deployed entirely on free tiers with enterprise-grade DDoS protection. Zero cost. Zero compromise.

### Changes in v4.0

> **Timer-based habit tracking:** Habits can now be configured as binary (done/not done) or timed (stopwatch/countdown). Timed habits persist server-side — closing the browser doesn't kill the timer. Duration accumulates across sessions in the same day. Timed habits cannot be manually marked done.
>
> **Calendar view:** The Today tab now includes a mini calendar with color-coded days showing completion density. Replaces arrow-only navigation for faster date jumping.
>
> **UI/UX overhaul:** Simplified layout — removed visual clutter, flattened information hierarchy, consolidated navigation. Single-screen daily view with inline calendar. Analytics moved to a cleaner card-based layout.

---

## 2. Platform, Cost, Stack, Auth, Security

**No changes from v3.0.** Sections 2–7 of PRD v3.0 remain in full effect:

- Cloudflare Pages + Workers + D1 (free tier)
- PBKDF2 via Web Crypto API for password hashing
- D1-backed rate limiting
- IDOR protection, Zod validation, security headers, audit logging
- Unified sign-in with invite codes
- JWT with token_version revocation + in-memory cache
- 193 integration tests in CI (including full timer suite)

All security, auth, and infrastructure specifications carry forward unchanged. Only schema additions, API additions, and UI/UX changes are documented below.

---

## 3. Habit Tracking Modes

### 3.1 Configuration at Creation Time

When creating a habit, the user picks a **tracking mode**. This is set once and **cannot be changed** after creation (prevents retroactive data manipulation).

| Mode | Behavior | Completion Trigger | Data Logged |
|------|----------|-------------------|-------------|
| **Binary** | Traditional checkbox. Tap to mark done. | User taps checkbox | None (or optional text/number via data_type) |
| **Stopwatch** | Timer counts up from 0:00. User starts and stops. | User stops the timer | `duration_seconds` (auto-logged) |
| **Countdown** | Timer counts down from a target. Auto-completes at 0. | Timer reaches zero OR user stops early | `duration_seconds` (auto-logged) |

### 3.2 Timer Behavior

**Starting:** User taps the play button on a timed task card. Server creates an `active_timer` record with `started_at` timestamp.

**While running:** The task card shows a live timer display. Time is calculated client-side as `now - started_at` (for stopwatch) or `target - (now - started_at)` (for countdown). The server is the source of truth — the client just renders.

**Stopping:** User taps stop. Server calculates `duration = now - started_at`, deletes the `active_timer`, and creates/updates the completion for today.

**Accumulation:** If a user runs the same timed habit multiple times in a day (e.g., morning run + evening run), the duration adds up:

```
Morning: 2h (7200s) → completion created: duration_seconds = 7200
Evening: 2h (7200s) → same completion updated: duration_seconds = 14400 (total 4h)
```

The UNIQUE constraint on `(task_id, completed_date)` ensures one row per day. Stop logic:
```
IF completion exists for today:
  UPDATE duration_seconds = duration_seconds + session_seconds
ELSE:
  INSERT with duration_seconds = session_seconds
```

**Browser close:** Timer keeps running server-side. On next page load, `GET /api/timers/active` returns all running timers. Client calculates elapsed from `started_at` and resumes the UI.

**Countdown auto-complete (client-side):** No server-side cron is used. Two client-side mechanisms cover all cases:
1. **Real-time:** While the user is watching, `TimerTaskCard` detects `remaining === 0` and automatically calls stop.
2. **On refetch:** `useActiveTimers` has `staleTime: 0` + `refetchOnWindowFocus: true`. Whenever data is fetched (page load, tab focus, manual refetch), the dashboard checks all active countdown timers against `now` and auto-stops any that have expired. This covers the background-tab / away case without a cron job.

**Discard:** User can cancel a running timer without logging any time.

### 3.3 Manual Override Rules

- **Binary tasks:** Can be toggled done/undone freely (same as v3).
- **Timed tasks:** CANNOT be manually marked done. The only way to complete is via the timer. This prevents users from gaming their tracking data.
- **Retroactive logging for timed tasks:** Not supported. If you forgot to start the timer, that session is lost. This is intentional — the timer is the source of truth.
- **Past dates:** Timed tasks show historical completion data (duration logged) but cannot start timers for past dates. Binary tasks can be retroactively toggled on past dates (same as v3).

### 3.4 Data Interaction

Timed tasks can ALSO have `data_type` (text/number/both) configured. When the timer stops, the card expands to show optional data entry fields (e.g., "distance: 5km", "notes: felt good"). Duration is always auto-logged separately from user data.

---

## 4. Schema Changes (Additive to v3.0)

### 4.1 Tasks Table — New Columns

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| tracking_mode | TEXT | NOT NULL, default 'binary' | `binary` \| `stopwatch` \| `countdown`. Set at creation, immutable. |
| timer_target_seconds | INTEGER | nullable | Required if `countdown`. Target duration in seconds. NULL otherwise. |

### 4.2 Completions Table — New Column

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| duration_seconds | INTEGER | nullable | Total accumulated seconds for the day. NULL for binary tasks. |

### 4.3 New Table: active_timers

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | TEXT | PK | UUID |
| user_id | TEXT | FK → users.id, NOT NULL | Owner |
| task_id | TEXT | FK → tasks.id, NOT NULL | Which timed task |
| started_at | TEXT | NOT NULL | ISO 8601 UTC timestamp |
| UNIQUE | — | (user_id, task_id) | One active timer per task per user |

### 4.4 New Indexes

- `idx_active_timers_user` ON active_timers(user_id)
- `idx_active_timers_task` ON active_timers(task_id)

---

## 5. New API Endpoints (Additive to v3.0)

### 5.1 Timer Endpoints

| Method | Endpoint | Body | Response | Notes |
|--------|----------|------|----------|-------|
| POST | /api/timers/start | { task_id } | { timer: { id, task_id, started_at } } | Fails if timer already running for this task. Validates task is timed + active. |
| POST | /api/timers/stop | { task_id } | { completion: { id, duration_seconds } } | Calculates duration. Deletes active_timer. Creates/updates completion. |
| GET | /api/timers/active | — | { timers: [...] } | All running timers for user. Called on page load. |
| POST | /api/timers/discard | { task_id } | { ok: true } | Cancel without logging time. Deletes active_timer. |

### 5.2 Updated Task Creation

`POST /api/tasks` body now accepts:

```json
{
  "name": "Morning Run",
  "frequency_type": "daily",
  "tracking_mode": "stopwatch",
  "timer_target_seconds": null,
  "data_type": "number",
  "data_label": "km"
}
```

Validation:
- `tracking_mode`: required, enum `binary | stopwatch | countdown`
- `timer_target_seconds`: required if countdown (min 10s, max 86400s/24h), must be null otherwise
- Existing task PATCH cannot modify `tracking_mode` or `timer_target_seconds`

### 5.3 Calendar Data Endpoint

| Method | Endpoint | Params | Response | Notes |
|--------|----------|--------|----------|-------|
| GET | /api/analytics/calendar | ?month=YYYY-MM | `{ days: [{ date, completed, total, ratio }] }` | Completion ratio per day for the given month. Used to color-code the calendar. |

---

## 6. UI/UX Redesign

### 6.1 Design Principles (v4)

The v3 UI works but is busy. v4 follows three rules:

1. **One thing per screen.** Each view has a single primary action. Secondary actions are tucked away.
2. **Progressive disclosure.** Show the minimum needed. Details expand on interaction.
3. **Calm interface.** Muted defaults, color only where it carries meaning (task colors, completion states, calendar heat).

### 6.2 Navigation (Simplified)

**Mobile (< 768px):** Two bottom tabs only.

| Tab | Icon | Label |
|-----|------|-------|
| Today | ✓ (check) | Today |
| Insights | ◐ (chart) | Insights |

Settings accessed via avatar/gear icon in top-right header (opens /settings page). God mode accessed from Settings page (visible only to god users). Fewer tabs = less cognitive load.

**Desktop (≥ 768px):** Left rail with same two items + settings icon at bottom. No sidebar labels by default — icon-only rail (48px wide). Hover expands to show labels.

### 6.3 Today Tab — Redesigned

The Today tab is a single cohesive screen with two zones stacked vertically:

#### Zone 1: Date Header + Calendar Picker (top)

A card containing:

1. **Date navigation row** (always visible):
   ```
   ←   Saturday, 21 March 2026   →
   ```
   - Left/right arrows navigate one day at a time.
   - The date label is tappable — toggles the calendar picker open/closed.
   - The right arrow is disabled when viewing today.

2. **"← Back to today" link** — only shown when viewing a past date.

3. **Progress summary** — shown when tasks are scheduled: `2/3 · 67%`

4. **Calendar picker** (conditional, opens on tap of date label):
   - Full month grid (7 columns × 5-6 rows, M T W T F S S headers).
   - Each day is color-coded by completion ratio:
     - No data: `--muted` (grey)
     - 0%: `--destructive/20` (faint red)
     - 1–49%: `amber-500/30` (faint amber)
     - 50–99%: `--primary/30` (faint purple/blue)
     - 100%: `green-500/40`
     - Today: `ring-2 ring-primary` inset
     - Selected: solid `--primary` with white text
     - Future: `opacity-30`, disabled
   - Month navigation arrows inside the calendar.
   - Tapping a date selects it **and closes the picker**.
   - Data source: `GET /api/analytics/calendar?month=YYYY-MM`. Cached 5 min by TanStack Query.

#### Zone 2: Task List (bottom, scrollable)

The task list fills the remaining vertical space. Each task is a card:

**Binary task card:**
```
┌─────────────────────────────────────┐
│ ● Task Name                    [ ✓ ]│
│   MWF · Tracked: notes              │  ← subtitle line (frequency + data type), muted
└─────────────────────────────────────┘
```
- 4px left border in task color
- Checkbox on right: empty (undone) or filled with task color (done)
- Subtitle line shows frequency shorthand + data tracking type (if any). Muted text.
- Tapping checkbox toggles completion. If data_type is set, card expands to show input field below.

**Timed task card (idle):**
```
┌─────────────────────────────────────┐
│ ● Morning Run                  [ ▶ ]│
│   Daily · Stopwatch                 │
└─────────────────────────────────────┘
```
- Play button (▶) instead of checkbox
- Subtitle shows frequency + tracking mode

**Timed task card (running):**
```
┌─────────────────────────────────────┐
│ ● Morning Run              01:23:45 │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  ← progress bar (countdown) or accent line (stopwatch)
│                      [ ⏹ ] [ ✕ ]   │  ← Stop + Discard buttons
└─────────────────────────────────────┘
```
- Live timer display replacing the play button
- For countdown: progress bar showing time remaining
- For stopwatch: thin accent line in task color (pulsing slowly)
- Stop button (⏹): saves duration, marks complete
- Discard button (✕): cancels without saving (confirmation dialog first)

**Timed task card (completed today, not running):**
```
┌─────────────────────────────────────┐
│ ● Morning Run          ✓ 2h 15m    │
│   Daily · Stopwatch    [ ▶ ]       │  ← can start again to accumulate
└─────────────────────────────────────┘
```
- Shows total duration for the day with a green checkmark
- Play button still visible — starting again accumulates more time
- No undo for timed completions (duration is additive, undoing is confusing)

**Quick actions at bottom of list:**
- "+ Add Habit" button (full width, subtle outline style)
- No "Manage Habits" link — moved to Settings

### 6.4 Add Habit Flow (Updated)

Bottom sheet (mobile) or modal (desktop). Steps:

1. **Name** (required): Text field. Placeholder: "e.g., Morning run, Read, Meditate"
2. **Tracking mode** (required): Three-way toggle:
   - `Done/Not Done` (binary) — default
   - `Stopwatch` (time, count up)
   - `Countdown` (time, set target)
3. **If countdown:** Duration picker (hours:minutes). Min 10s, max 24h.
4. **Frequency:** Toggle: "Every day" or "Specific days" → weekday buttons
5. **Track extra data?** Toggle (default off). If on: type selector (Text/Number/Both) + label field.

The form is a single vertical flow, no tabs or steps. Fields appear/disappear based on tracking mode selection (progressive disclosure).

### 6.5 Insights Tab — Redesigned

Replaces "Analytics" tab. Cleaner name, cleaner layout.

**Single scrollable page with sections:**

#### Section 1: Summary Strip

Horizontal row of 3 stat pills (no cards, no borders — just text):

```
🔥 12-day streak    ·    78% this week    ·    Best: 23 days
```

#### Section 2: Overview Chart

One chart at a time. Clean dropdown to switch chart type (Bar, Line, Pie, Area). Timeframe segmented control below: Week | Month | Year | All.

Default: Bar chart, Month view.

**Heatmap Calendar:** Instead of being a chart option in the dropdown, the heatmap is the calendar on the Today tab itself. Removed from chart dropdown to avoid redundancy.

#### Section 3: Per-Task Breakdown

Expandable list of tasks. Each row shows:

```
● Task Name        87% · 🔥 5    ▸
```
(color dot, name, completion rate for selected timeframe, current streak, expand arrow)

Tapping a task expands inline (no page navigation) to show:
- Consistency line chart (with 7-day rolling average toggle)
- **For timed tasks:** Duration chart (bar chart of daily duration over selected timeframe) + stats (avg session, longest session, total hours)
- **For tasks with data_type:** Data chart (line for numbers, scrollable log for text)
- Stats: completion rate, current streak, longest streak, total completions

This replaces the "Task Deep Dive" as a separate view. Everything is inline, expandable, one scroll.

#### Section 4: Duration Leaderboard (new, only if timed tasks exist)

Simple ranked list:

```
This week's time invested:
1. Morning Run        8h 32m
2. Meditation         3h 15m
3. Study              2h 45m
   Total             14h 32m
```

Timeframe follows the same toggle as Section 2.

### 6.6 Settings Page (Simplified)

Single scrollable page, no sub-routes:

**Profile**
- Display name (editable inline)
- Username (read-only, muted)
- Timezone (dropdown)
- Save button (only appears when changes are made)

**Account**
- Change Password (expandable section)
- Theme: Light / Dark / System (radio group)

**Habits**
- Drag-to-reorder list of all tasks (active + paused)
- Each row: color dot, name, tracking mode icon (✓/⏱/⏳), frequency, status pill
- Tap to expand: Edit name, frequency, data type/label. Tracking mode shown but not editable.
- Swipe left (mobile) / hover (desktop): Pause/Resume, Archive
- Archived section collapsed at bottom

**Admin** (only visible if is_god=1)
- Link to /admin page

**Sign Out**
- Destructive-styled button at the bottom of the page. Calls logout, clears JWT, redirects to login.

### 6.7 God Mode (/admin)

No UI changes from v3.0. Same search, user detail, password reset, invite code management. Timer data (active timers, duration history) visible in user detail view.

### 6.8 Visual Cleanup Summary

| v3 (was) | v4 (now) | Why |
|----------|----------|-----|
| 3 bottom tabs (Today, Analytics, God) | 2 bottom tabs (Today, Insights) | Less navigation noise. God mode is admin-only, doesn't need a tab. |
| Arrows + calendar icon for date nav | Date header `← Weekday, DD Month YYYY →` with tap-to-open calendar picker | Old design restored as always-visible header; calendar is a secondary layer |
| Always-visible calendar strip | Calendar hidden by default, opens on tap of date label | Reduces visual weight; calendar appears only when needed |
| Daily summary as progress ring + cards | `2/3 · 67%` inline in date card | Less visual weight, same information |
| Analytics as two-view toggle (Overview + Deep Dive) | Single scroll with expandable sections | No mode switching, everything accessible inline |
| Heatmap as a chart option | Heatmap IS the calendar picker on Today tab | Eliminates redundancy, puts the heatmap where it's most useful |
| "Manage Habits" link on Today page | Habits management in Settings only | Keep Today tab focused on tracking, not configuration |
| Separate route for task editing | Inline expansion in Settings | Fewer page transitions |
| Completion percentage as large number + ring | Small text pill `2/3 · 67%` | De-emphasize gamification, emphasize consistency |
| No sign-out button | Sign Out button at bottom of Settings | Basic UX requirement |

---

## 7. Analytics for Timed Tasks

### 7.1 Per-Task Duration Analytics

Available in the expanded task view on Insights tab:

| Metric | Calculation |
|--------|------------|
| Total time (timeframe) | SUM(duration_seconds) for completions in range |
| Average session | Total time / number of completions in range |
| Longest session | MAX of individual session durations (requires storing per-session data — see 7.3) |
| Sessions today | Number of timer stop events today (derived from accumulation pattern) |
| Completion rate | Days with any timer completion / scheduled days in range |

### 7.2 Charts for Timed Tasks

| Chart | X-Axis | Y-Axis | Notes |
|-------|--------|--------|-------|
| Daily Duration Bar | Days | Minutes/Hours | Shows total accumulated duration per day |
| Trend Line | Days | Duration (smoothed) | 7-day rolling average of daily duration |
| Distribution Pie | Tasks | Proportion of total time | Which timed tasks consume the most time |

These integrate into the existing Insights chart area. When a timed task is selected, the consistency chart switches to show duration instead of binary completion.

### 7.3 Session Tracking (Design Decision)

The current `duration_seconds` on completions stores the **accumulated total** for the day. This means we lose individual session data (we can't distinguish "one 4h session" from "two 2h sessions").

**Decision:** Accept this limitation for v4. Individual session tracking would require a separate `timer_sessions` table, adding schema complexity. The total daily duration is sufficient for analytics. If users request per-session breakdowns, add a `timer_sessions` table in v5.

### 7.4 Calendar Color Coding for Timed Tasks

Timed tasks contribute to the daily completion ratio the same way as binary tasks:
- A timed task with `duration_seconds > 0` for the day = completed
- A timed task with no completion for the day = not completed

The calendar heat colors reflect the ratio across ALL task types (binary + timed) for the day.

---

## 8. Updated Schema Summary (Complete)

For reference, here is the complete list of tables in v4:

| Table | New in v4? | Purpose |
|-------|-----------|---------|
| users | No | User accounts |
| invite_codes | No | Signup gating |
| tasks | Modified (2 new columns) | Habit definitions |
| completions | Modified (1 new column) | Daily completion records |
| active_timers | **Yes** | Server-side timer persistence |
| audit_log | No | Security event logging |
| rate_limits | No | D1-backed rate limiting |

---

## 9. Updated Acceptance Criteria (Additive to v3.0)

| # | Criterion | Verification |
|---|----------|-------------|
| AC-27 | User can create a stopwatch habit | Create task with tracking_mode=stopwatch |
| AC-28 | User can create a countdown habit with target | Create task with tracking_mode=countdown, timer_target_seconds=1800 |
| AC-29 | Tracking mode cannot be changed after creation | PATCH task, attempt to change tracking_mode, verify 400 |
| AC-30 | Timed task shows play button, not checkbox | Visual inspection on Today tab |
| AC-31 | Starting timer creates server-side active_timer | POST /api/timers/start, verify row in active_timers |
| AC-32 | Timer persists across browser close/reopen | Start timer, close tab, reopen, verify timer still running |
| AC-33 | Stopping timer logs duration_seconds on completion | Stop timer, verify completion row has duration |
| AC-34 | Multiple sessions in same day accumulate | Run 1h, stop. Run 1h, stop. Verify duration_seconds = 7200 |
| AC-35 | Countdown auto-completes at zero (watching) | Start 10s countdown, stay on page, verify completion created at 0 |
| AC-35b | Countdown auto-completes on refetch (away) | Start 10s countdown, switch tabs for 15s, come back, verify completion created |
| AC-36 | Timed task cannot be manually marked done | Verify no checkbox, no POST /api/completions for timed tasks |
| AC-37 | Discard cancels timer without logging | Start, discard, verify no completion created |
| AC-38 | Calendar shows color-coded days | View Today tab, verify calendar has colored day cells |
| AC-39 | Calendar navigation works (month swipe, day tap) | Swipe to previous month, tap a day, verify task list updates |
| AC-40 | Calendar hidden by default, opens on date tap | Tap date label, verify calendar appears; tap a date, verify it closes |
| AC-41 | Insights tab shows duration chart for timed tasks | Expand a timed task in Insights, verify bar chart |
| AC-42 | Duration leaderboard shows ranked timed tasks | Check Insights page with 2+ timed tasks |
| AC-43 | Only 2 bottom tabs on mobile (Today, Insights) | Visual inspection |
| AC-44 | Settings accessible via header icon | Tap gear icon, verify /settings opens |
| AC-45 | Sign Out button in Settings logs user out | Tap Sign Out, verify redirect to login + JWT cleared |
| AC-46 | Sidebar shows brand icon when collapsed | On desktop, collapse sidebar, verify CheckSquare icon visible |

---

## 10. Error Handling (Additive to v3.0)

| Scenario | Behavior | UI Feedback |
|----------|----------|-------------|
| Start timer on already-running task | 409 Conflict | Toast: "Timer already running for this habit." |
| Start timer on binary task | 400 | Should never happen (UI hides play button). API rejects. |
| Start timer on paused/archived task | 400 | Toast: "This habit is not active." |
| Stop timer with no active timer | 404 | Toast: "No timer running for this habit." |
| Start timer for past date | 400 | Timers only work for today. Past date view hides play button. |
| Countdown auto-completes while watching | Client detects remaining === 0, calls stop | Timer card updates to completed state. |
| Countdown auto-completes while away | On window focus refetch, expired timers are auto-stopped | Next view of Today tab shows completed state. |
| Discard running timer | Confirmation dialog | "Discard this session? Time won't be logged." → Discard / Keep Running |

---

## 11. Migration Path from v3 → v4

1. **Schema migration:** ✅ `0002_v4_timers.sql` applied to production. Added `tracking_mode`, `timer_target_seconds` to tasks. Added `duration_seconds` to completions. Created `active_timers` table with indexes.
2. **API additions:** ✅ `/api/timers/start|stop|active|discard`, `/api/analytics/calendar`. Updated `POST /api/tasks` validation. `POST /api/completions` rejects timed tasks.
3. **Frontend:** ✅ Date header + tap-to-open calendar picker. Timer task cards with live display. Insights page. 2-tab nav. Settings with sign-out.
4. **Cron:** ❌ Not implemented. Replaced by client-side auto-stop on real-time countdown expiry + window-focus refetch. No Cloudflare Cron Trigger needed.
5. **Tests:** ✅ 193 integration tests passing, including full timer suite (`tests/integration/timers.test.ts`).

All existing binary tasks continue to work unchanged. No data migration needed for existing completions.

---

*— End of Document —*