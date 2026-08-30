# LifeLayer — Production-Readiness & Security Audit

**App:** LifeLayer (Expo name) / `ProductivityNative` (slug) — Expo SDK 54, React Native 0.81, expo-router, Supabase backend
**Repo:** `C:\Users\shrey\Downloads\ProductivityNative` (git `main` @ `01e2a1b`)
**Audit date:** 2026-08-05
**Method:** Static source review of the full repo + SQL + edge function + native config; safe toolchain checks (`npm audit`, `tsc`, `expo-doctor`, `expo export`); a 6-dimension multi-agent finder pass (auth, backend/RLS, data/reliability, screens, community/privacy, App Store/native/deps) followed by an 18-item adversarial verification pass. No code was modified. No deploy, credential rotation, or destructive action was performed.

> **Confidence legend:** **Verified** = the exact code was read and definitively shows the issue. **Likely** = strong inference, one step removed. **Inferred** = plausible, depends on config/runtime not visible in-repo.
> Every High/Critical finding below was independently re-checked by a second adversarial pass; the "Verification" line records that verdict, including corrections and refutations.

---

## 0. Remediation Status (updated 2026-08-05, after fixes)

**All findings in this report have been fixed in code.** The audit below is preserved as written; this section records what changed and what is left.

### ⚠️ Two deployment steps are now mandatory before the app will work

1. **Apply `supabase/audit-fixes.sql`** in the Supabase SQL Editor, in this order:
   `schema.sql → rls-supplement.sql → security-fixes.sql → ai-workout-limits.sql → audit-fixes.sql`.
   **The app's AI features will be broken until you do.** The edge function now calls the new `consume_ai_limit()` RPC and *fails closed* when it is missing, so every Create-routine / Advise / Looks-analysis / screenshot-import call would return "Daily limit reached" for every user. (Avatar upload and moderation fail open and are unaffected.)
2. **Redeploy the edge function**: `npx supabase functions deploy openai-proxy`. Avatar uploads now go through its new `upload_avatar` action, and direct client writes to the `avatars` bucket are revoked by the migration — so the migration and the function must ship together.

Also note the migration **backfills** `report_count` from existing reports and enables auto-hide at ≥5 reports, so already-reported posts may disappear from the feed on deploy. That is intended.

### Verification performed
| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean (app code) |
| `npx expo export --platform ios` | **Exit 0** — 6.4 MB Hermes bundle |
| `npx expo-doctor` | Peer-dependency + version checks now pass |
| `npm audit` | 22 → **20** vulns; **critical `tar` advisory resolved**; all remaining are build-tooling only |
| Content-filter regression suite | 34/34 real phrases pass, 17/17 obfuscations blocked |
| Independent adversarial re-review | 3 agents; **16 regressions found and fixed** (see below) |

### Regressions the remediation itself introduced — found by re-review and fixed
The first fix pass created new bugs, several worse than the originals. All were corrected:
- **Retry queue could destroy data.** Supabase reads return `{data: null, error}` rather than throwing, so an offline read yielded defaults that were then *queued* — replaying a "day 1" streak over a real 47-day streak, and a blank routine-run over real history. Reads now distinguish "no row" from "read failed" and refuse to persist a guess.
- **`refreshFromCloud` could wipe every local record.** An empty server response is truthy as `[]`, so it overwrote populated caches. For an existing install whose older writes had silently failed, the first foreground would have erased all tasks, journals, schedule items and calendar events. It now never lets an empty response replace a populated cache.
- **Queue could lose writes**: flushing wrote a stale snapshot back (erasing anything queued mid-flush), `enqueue` was an unserialized read-modify-write, `flushQueue()` returned early while a flush was in flight (so `signOut` discarded pending writes), and the dedupe key included mutable payload bytes. The queue was rewritten: id-based removal of only successful ops, all mutations serialized, shared in-flight promise, identity-column dedupe.
- **Deep Work became unreachable** — removing dead code deleted the feature's only launcher. Restored.
- **AI limit/flag messages were dead code** — non-2xx bodies arrive on the error object, so users saw "Edge Function returned a non-2xx status code" instead of the real reason. Fixed at all three call sites.
- **Content filter false positives**: "pistol squat" and "finish it" were blocked (matching "piss"/"shit"). Separator-stripping is now targeted at genuinely spaced-out text, client and server.
- Plus: `blockUser` would fail with RLS 42501 on a repeat block; raw Postgres codes (`bio_too_long`) shown to users; legacy timed sets rendering as "—"; hardcoded `lb` for kg users; meal picker showing `0 kcal`.

### What could NOT be verified here
Runtime behaviour on a device, live SQL execution, and the App Store submission itself. **The migration and edge function have not been deployed** — that is yours to run. After deploying, smoke-test: create an AI routine, upload an avatar, block a user, report a post, and confirm a rename survives.

---

## 1. Executive Summary & Launch Recommendation

LifeLayer is a **more mature and security-conscious codebase than its "vibe-coded" framing suggests.** The backend is the strong point: Row Level Security is enabled on every table, there is a dedicated `security-fixes.sql` that already closed 8 real prior vulnerabilities (friendship self-accept, profile over-exposure, author-identity spoofing, admin reporter-leak, avatar storage scoping, paid-AI cost cap, 13+ floor, self-delete RPC), the OpenAI key never touches the client, all AI runs through a JWT-authenticated Edge Function, secrets hygiene is clean (no secrets in the client or git history), and the production JS bundle exports without error. `tsc` passes and logging is minimal (no PII).

**However, it must not be submitted to the App Store in its current state.** There are two guaranteed-rejection blockers and one crash risk that are launch-stopping regardless of everything else:

1. **Privacy Policy and Terms screens are empty stubs** ("Content intentionally left blank") yet users are told at signup they "agree" to them — a certain Guideline 5.1.1 rejection and a real consent defect for an app collecting face photos, minors' ages (≥13), and body metrics.
2. **No way to block/mute another user** — Apple Guideline 1.2 requires blocking for any app with user-generated content (this app has a public routine/post feed). Near-certain rejection.
3. **Missing peer dependencies (`expo-font`, `expo-constants`, `expo-linking`)** that "may crash outside Expo Go" — a real crash-on-launch risk in a standalone (App Store/TestFlight) build, which is not Expo Go.

Beyond those, the most material engineering risks are a **cluster of client data-layer reliability defects** — a server-side AI rate-limit that is defeated by concurrent requests, a local-first cache that never re-syncs (silent permanent cross-device divergence), silent `catch {}` around every cloud write (data lost on reinstall), and read-modify-write races on routine/streak/meal data. None are data breaches; all are correctness/durability problems that will produce "my data disappeared" support tickets.

**Final decision: `SUBMIT AFTER LISTED BLOCKERS ARE FIXED`.** In its current state it is a **DO-NOT-SUBMIT**. The blockers are well-scoped and mostly small; there is no fundamental architectural rework required. Internal TestFlight testing is viable now *after* the peer-dependency fix; external TestFlight and App Store require the full "Required before submission" list below.

### Score at a glance

| Dimension | Rating |
|---|---|
| **Engineering maturity** | **6.5 / 10** |
| **Vibe-coded risk** | **Moderate** |
| Security (backend enforcement) | Strong architecture; a few real gaps (image UGC, AI cost cap) |
| Reliability / data durability | **Weak** — systemic RMW races + silent write failures + cache divergence |
| App Store readiness | **Not ready** — 2 guaranteed-rejection blockers + 1 crash risk |
| Secrets & supply chain | Clean (all npm vulns are build-tooling only) |

### Finding counts (after verification & de-duplication)

| Severity | Count | Notes |
|---|---|---|
| Critical (launch-blocker) | 2 | Blank legal docs; missing block-user (both are App-Store rejections, not code-exploits) |
| High | 8 | AI rate-limit race, cache divergence, silent write loss, checkbox race, Android-broken workout create/rename, image moderation not backend-enforced, face-photo disclosure, community-post reports inert |
| Medium | 14 | Cost/abuse gaps, RMW races (meals/streak), missing error states, permission hygiene, missing peer deps, no-normalization blocklist, etc. |
| Low | 11 | Nonce, password-min drift, dead code, data-model drift, no data export, etc. |
| Info / correctly-handled | 5 | Client rate-limit (advisory by design), scheme note, privacy manifest, patch drift |
| **Refuted during verification** | 2 | "AI skin analysis" permission strings (feature is real); "unsigned CI = no store path" (EAS is the path) |

---

## 2. Architecture, Trust Boundaries & Sensitive-Data Flows

### Components
- **Client** (Expo/RN, ships to device): expo-router screens under `app/`, data layer in `lib/`, UI in `components/`. Holds only `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (a *publishable* key, safe to ship). Session tokens stored in `expo-secure-store` (Keychain/Keystore), not plain AsyncStorage.
- **Supabase Postgres** — every table has RLS keyed on `auth.uid() = user_id`. Cross-user reads are gated by `can_view_data()` / `is_friend()` SECURITY DEFINER helpers driven by a per-profile `visibility` column.
- **Supabase Edge Function `openai-proxy`** (Deno) — the only holder of `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Validates the caller's JWT before any action, enforces server-side AI rate limits, and moderates text. This is the app's real server-side trust boundary for AI + cost.
- **Supabase Storage** `avatars` bucket — public-read, write-scoped to `<uid>/…` by RLS.
- **OpenAI** — third-party processor reached only via the Edge Function (chat/vision `gpt-4o-mini`, free `moderations` endpoint). Images are pass-through (not persisted server-side).

### Trust boundaries
```
[Device / client JS]  --anon key + user JWT-->  [Supabase RLS]        (data authz boundary)
[Device / client JS]  --user JWT-->             [openai-proxy EF]     (AI + cost + secret boundary)
                                    [openai-proxy EF] --service key--> [Postgres bypassing RLS]
                                    [openai-proxy EF] --OPENAI_KEY-->  [OpenAI]
```
**Security is enforced at the backend, not the UI** — verified. Client route-gating (`(tabs)/_layout.js`, `app/index.js`) is cosmetic; a bypassed redirect yields no data because every table requires `auth.uid()`. The client `canView` flag in `friend-profile.js` merely mirrors the RLS decision. The one class where this breaks down is **image/UGC moderation**, which is *only* client-side (see H-6).

### Sensitive data collected & where it goes
| Data | Collected in | Stored | Leaves device to |
|---|---|---|---|
| Email, name, username | signup/profile | `profiles` | Supabase |
| Age (≥13), sex, weight, height, target weight | onboarding | `user_goals`, `profiles` | Supabase |
| Face selfie (skin/hair AI) | `routine/[name].js` analyze | **not stored** (pass-through) | **OpenAI** |
| Profile avatar / workout progress photos | image picker/camera | `avatars` bucket (public) / device | Supabase |
| Meals, workouts, journal, routines, streaks | app usage | per-user tables | Supabase |
| Free-text bio, routine/post content | app usage | `profiles`, `shared_routines`, `community_posts` (public-read) | Supabase, visible to other users |

Face photos and health data are the most sensitive flows, and both are currently **undisclosed** (blank privacy policy + a medical-only disclaimer that never names OpenAI).

---

## 3. Findings by Severity

Each finding: **severity · confidence · dimension · file:line · evidence · impact · scenario · fix · effort · App Store impact · verification verdict.**

De-duplicated: the three "blank legal doc" reports are merged into C-1; the three "image moderation not enforced" reports are merged into H-6.

---

### 🔴 CRITICAL — Launch blockers (App Store rejection, not code-exploit)

#### C-1 · Privacy Policy and Terms & Conditions screens are empty stubs, yet presented as a binding agreement
- **Confidence:** Verified · **Dimension:** App Store / privacy
- **Location:** `app/(auth)/privacy.js:20`, `app/(auth)/terms.js:20`, linked from `app/(auth)/signup.js:146-149`
- **Evidence:** Both screens render only a header; the body is literally `{/* Content intentionally left blank — to be filled in later. */}`. `signup.js` states "By creating your account, you agree to LifeLayer's terms and conditions … privacy policy," with the two links routing to those blank pages.
- **Impact:** Apple Guideline 5.1.1(i) requires a functional privacy policy, and App Store Connect requires a valid Privacy Policy URL. The app collects face photos, minors' ages, body metrics, and shares inputs with OpenAI — none disclosed. A blank "agree to these terms" is both a guaranteed rejection and a legal/consent defect.
- **Scenario:** Reviewer taps the Privacy Policy link during review → blank page → rejection. Separately, every user "agrees" to text that does not exist.
- **Fix:** Write a real privacy policy (data collected: fitness metrics, photos, email/auth identifiers; purposes; **OpenAI as processor** for skin analysis + moderation, one-time, not stored; retention; deletion; 13+ floor) and terms/EULA (include a **Guideline 1.2 zero-tolerance clause for objectionable UGC**). Render them in-app *and* host at a public URL added to App Store Connect. Can link Apple's standard EULA for terms.
- **Effort:** Medium (writing) · **App Store impact:** Certain rejection under 5.1.1 + missing required Privacy Policy URL.
- **Verification:** **CONFIRMED** (2 independent verifiers). Both re-read all three files byte-for-byte. Severity calibrated to High as a pure code-security score, but retained as **Critical for launch** because it is a guaranteed rejection over minors' sensitive data.

#### C-2 · No mechanism to block/mute abusive users (Guideline 1.2 UGC requirement)
- **Confidence:** Verified · **Dimension:** App Store
- **Location:** `app/(tabs)/explore.js` (CardAuthorHeader ~L313-342, report handler L1122), `app/friend-profile.js` (no block control); project-wide grep for block/BLOCK finds only the word-filter + CSS names
- **Evidence:** The feed card offers only Delete (own) or Report (🚩). There is no block/mute anywhere — no `blocked_users` table, no client-side author hiding, nothing on the friend profile. Apple 1.2 requires *all four*: content filter, flag/report, **block abusive users**, and a way for the developer to act on reports. Three of four exist; **block is entirely absent**.
- **Impact:** A harassed user can report each post (rate-limited to 5/hr) but can never stop a specific user's future posts/bio from appearing. Blocking is the single most-cited missing UGC requirement in 1.2 rejections.
- **Scenario:** User A posts routines/bios targeting User B; B has no way to make A disappear from the feed.
- **Fix:** Add a **Block user** action to the card overflow and friend-profile. Persist to a new `blocked_users` table (RLS: own rows). Filter the feed client-side by the blocker's list, and ideally enforce server-side by excluding blocked authors from the `*_view` feed reads via an RPC/view.
- **Effort:** Medium · **App Store impact:** High-probability rejection under 1.2.
- **Verification:** **CONFIRMED.** Verifier confirmed no `blocked_users`/`user_block` table in any SQL file and no block control on either screen; noted the app *does* satisfy the other three 1.2 requirements. Severity calibrated High (pre-submission compliance, not a data breach) but **launch-blocking**.

---

### 🟠 HIGH

#### H-1 · Server-side AI rate-limit is a non-atomic read-check-write (TOCTOU) → the only paid-AI cost cap is defeated by concurrency
- **Confidence:** Verified · **Dimension:** reliability / cost-abuse
- **Location:** `supabase/functions/openai-proxy/index.ts:49-105` (generative 49-66, moderation 67-81, extract 82-104)
- **Evidence:** Each branch does `select count … maybeSingle()` → `if (current >= MAX) return 429` → `upsert({ count: current + 1 })`. The write stores an **absolute** value, not an atomic increment, and there is no DB-side CHECK/trigger backstop (`ai_rate_limits`/`ai_mod_limits`/`ai_workout_limits` are plain tables with read-only client policies).
- **Impact:** Concurrent requests all read the same stale `current`, all pass the gate, all run the paid `gpt-4o-mini`/vision call, all write the same value. The daily generative cap (3), weekly extract cap (10), and mod cap (60) can be blown open by firing N requests in parallel — defeating the app's sole server-side cost control on paid AI.
- **Scenario:** Authenticated attacker fires 100 concurrent `create_routine` requests → all read 0, all pass `>=3`, 100 paid completions charged where 3 were allowed.
- **Fix:** Do the check+increment in one atomic statement: `INSERT … ON CONFLICT (user_id,date) DO UPDATE SET count = table.count + 1 RETURNING count`, then reject when the returned count exceeds the cap (or wrap in a SECURITY DEFINER function so parallel calls serialize on the row).
- **Effort:** Small · **App Store impact:** None directly (cost/reliability).
- **Verification:** **CONFIRMED.** Verifier noted the `PAID_MOD` path already fail-opens past its cap without calling OpenAI (so its cost blast radius is self-limited), but the generative + `extract_workout` paths burn real paid calls on every racing request. Requires a valid JWT, but signup is open.

#### H-2 · Local-first reads never re-fetch Supabase once cached → permanent, silent cross-device divergence
- **Confidence:** Verified · **Dimension:** reliability
- **Location:** `lib/storage.js` getTasks/getDayTodos/getJournalEntries/getScheduleItems/getCalendarEvents (~L734-962); `lib/goalsStorage.js:29-48`; `lib/productivityStorage.js:12-45`
- **Evidence:** Every getter is read-through cache: `const raw = await AsyncStorage.getItem(key); if (raw !== null) return JSON.parse(raw)`. The Supabase branch runs only when `raw === null`. There is no cache invalidation anywhere — `signOut` (`AuthContext.js:150`) calls only `supabase.auth.signOut()` and never clears local keys.
- **Impact:** Once a device has any local copy of a collection, it never reads Supabase again. Edits/deletes on device B reach Supabase but device A serves its stale cache forever. Tasks, todos, journals, schedule, calendar events, goals, and productivity sessions all diverge permanently across devices.
- **Scenario:** User adds a task on their phone; on their tablet (used once before) it never appears. User deletes a calendar event on the tablet; it persists on the phone. Two devices hold different truth indefinitely.
- **Fix:** On cold start / login / foreground, fetch each collection from Supabase and overwrite local; or add an `updated_at`/version column and merge newest-wins. At minimum treat Supabase as source of truth on cold start rather than unconditionally returning the local cache.
- **Effort:** Medium · **App Store impact:** None directly (but drives "my data is wrong" reviews).
- **Verification:** **CONFIRMED.** No server-side data loss; RLS unaffected. Defensible as Medium for single-device users, but High because it silently defeats cross-device sync across seven collections.

#### H-3 · Silent `catch {}` around every Supabase write → data lost on reinstall / new device
- **Confidence:** Verified · **Dimension:** reliability
- **Location:** `lib/storage.js` saveDayTodos:757, saveDayRules:785, saveTask:821-827, deleteTask:834, saveJournalEntry:866-871, saveScheduleItem:917-926, saveCalendarEvent:971-977; `lib/goalsStorage.js:53-72`; `lib/productivityStorage.js:53-66`
- **Evidence:** Pattern is `await AsyncStorage.setItem(...); try { await supabase.from(...).upsert(...) } catch {}`. The empty catch swallows offline errors, transient 5xx, and RLS rejections identically. Project-wide grep confirms **no** retry queue, dirty flag, `NetInfo`, or connectivity-triggered flush exists.
- **Impact:** When the cloud write fails, the failure is invisible and never retried. Because the getters read Supabase *only* on a fresh install / new device (H-2), any write that failed to reach Supabase is permanently lost the moment the app is reinstalled or its cache is wiped.
- **Scenario:** User logs a week of journal entries + tasks offline (all save locally, cloud upserts silently fail). Phone is later reset → the week is gone because it never reached the server and nothing retried.
- **Fix:** Capture the error, mark the row dirty, and flush a pending-writes queue on reconnect; at minimum surface a "sync failed" indicator. Never use bare `catch {}` on the user's only durable copy.
- **Effort:** Large · **App Store impact:** None directly.
- **Verification:** **CONFIRMED.** Nuance: whole-object stores (`day_todos`, `day_rules`, `user_goals`) self-heal on the next successful save of the same key; the sharpest durable-loss risk is `saveTask` (per-row), `saveJournalEntry` (per-date), and `saveProductivitySession` (insert-only, never re-written).

#### H-4 · `quickCheckToggle` read-modify-writes the whole routine_runs blob → rapid checkbox taps lose completions and corrupt history/streak
- **Confidence:** Verified · **Dimension:** reliability
- **Location:** `lib/storage.js:200-234`, called from `app/routine/[name].js:1722` (checkbox `onPress` ~L2494)
- **Evidence:** Each tap `getTodayRun` → toggles one step in the in-memory JSON blob → `upsert({ data: updated })` → derives `history.completion` + `_updateStreak`. The checkbox has no disabled/pending guard, no debounce, no optimistic update; the round-trip is awaited before `setRun`.
- **Impact:** Two rapid taps both read the same pre-write blob; the second write clobbers the first tap's toggle (whole-blob rewrite). Derived `completion` and streak are computed from the losing snapshot, so the calendar percentage and streak get corrupted and a finished routine can fail to register.
- **Scenario:** User taps three checkboxes quickly → final saved run shows only the last checked; history shows ~33% instead of 100%.
- **Fix:** Make the toggle a local optimistic update and debounce/serialize persistence, or flip the step server-side via an RPC so concurrent taps don't overwrite each other.
- **Effort:** Medium · **App Store impact:** None directly.
- **Verification:** **CONFIRMED.** Reachable via a very common interaction (rapid tapping); silently corrupts persisted history/streak.

#### H-5 · `Alert.prompt` used for New-Workout and Rename-Workout → silent no-op on Android (two core Fitness flows dead)
- **Confidence:** Verified · **Dimension:** engineering-quality
- **Location:** `app/routine/[name].js:1866` (create), `:1906` (rename)
- **Evidence:** Both use `Alert.prompt(...)` with `'plain-text'`. React Native's `Alert.prompt` is iOS-only (`node_modules/react-native/Libraries/Alert/Alert.js`: `if (Platform.OS === 'ios')` with no else). No Platform guard or polyfill surrounds either call.
- **Impact:** On Android, tapping "+ New" to create a workout and long-press → Rename do nothing at all — the custom-workout feature is unusable on Android. (Delete works; it uses cross-platform `Alert.alert`.)
- **Scenario:** Android user taps "+ New" under My Workouts → no prompt, nothing happens.
- **Fix:** Replace `Alert.prompt` with a cross-platform `TextInput` modal (the app already has this pattern in `setup-routine`/weekly modals).
- **Effort:** Medium · **App Store impact:** Not an iOS rejection (App Store is iOS), but a functionality-rejection risk on the Play Store and a broken cross-platform experience.
- **Verification:** **CONFIRMED** via the RN source; no shim exists.

#### H-6 · Image / avatar UGC moderation is client-side only and fails open — the backend never enforces it
- **Confidence:** Verified · **Dimension:** App Store / security (merges 3 finder reports)
- **Location:** `lib/profileStorage.js:4-16` (moderateImage), `:86-115` (pickAndUploadAvatar); `app/(tabs)/explore.js:270-279`; `supabase/functions/openai-proxy/index.ts:78, 209`; storage RLS `security-fixes.sql:224-246`
- **Evidence:** `moderateImage` catches all errors and only re-throws the explicit "flagged" message — "Network/function errors are non-blocking — let the upload proceed." The storage upload and `avatar_url` write then run regardless. The Edge Function fails open in two places (`{allowed:true}` once the mod cap is passed at L78, and `{allowed:true}` on any exception at L209). No DB trigger validates images (`assert_text_clean` fires only on text). Storage RLS gates writes only on folder ownership, with **zero content validation** — a scripted client can call `storage.upload` + `profiles.upsert` directly and never invoke moderation. Because a security-fix trigger copies `author_avatar_url` from the real profile, an explicit avatar propagates to every public-feed post header.
- **Impact:** No backend gate prevents an inappropriate/explicit profile image from being stored in the public `avatars` bucket and shown to all users. Text has a DB backstop; images have none. Guideline 1.2 objectionable-imagery exposure.
- **Scenario:** Attacker uploads an explicit avatar by calling `storage.upload` + `profiles.upsert` directly (never invoking `moderate_image`); it renders publicly on their profile and post headers.
- **Fix:** Enforce image moderation server-side — gate `avatar_url` acceptance behind a server-verified moderation record, or moderate in a Storage/Edge trigger and quarantine unreviewed images. Never treat network/exception paths as "allowed." Add a real takedown path for reported images.
- **Effort:** Medium · **App Store impact:** 1.2 UGC-safety gap; a determined reviewer probing UGC could surface it.
- **Verification:** **CONFIRMED.** Verifier confirmed the fail-open triggers fire even in the normal UI flow (network error or exceeding the shared 60/day cap), not only under scripted bypass.

#### H-7 · Face photo is sent to OpenAI with no disclosure that it leaves the device / is processed by a third party
- **Confidence:** Verified · **Dimension:** privacy
- **Location:** `app/routine/[name].js:645-650` (analyzeImage), disclaimer `:864-867`; transit `supabase/functions/openai-proxy/index.ts:301-322`
- **Evidence:** `analyzeImage` sends the raw base64 selfie via `supabase.functions.invoke('openai-proxy', { body: { action: 'analyze_looks', base64 } })`. The only consent gate is a **medical** disclaimer ("general self-care guidance only … speak with a dermatologist") that never states the image is uploaded or processed by OpenAI. The Edge Function forwards it to `gpt-4o-mini`. The privacy policy (C-1) is blank, so there is no disclosure anywhere.
- **Impact:** Users (as young as 13) upload face photos believing it is on-device "self-care," with no indication of third-party sharing. Violates Apple 5.1.1/5.1.2 disclosure/consent expectations.
- **Scenario:** A 13-year-old takes a selfie for a skincare routine; it is sent to OpenAI with no user-facing statement that this happens.
- **Fix:** Amend the disclaimer to state the photo is securely sent to a third-party AI provider (OpenAI) for one-time analysis and is **not stored** (true — it is pass-through), and require explicit consent. Document in the privacy policy.
- **Effort:** Small · **App Store impact:** 5.1.1/5.1.2 — data collection & third-party sharing must be disclosed and consented.
- **Verification:** **CONFIRMED.** Good: the Edge Function does not persist the image — keep it that way and say so.

#### H-8 · Reports on community_posts (deep-work / workout / meal-day) have no server or UI effect — 3 of 4 feed types have a cosmetic flag button
- **Confidence:** Verified · **Dimension:** App Store
- **Location:** `supabase/schema.sql:342-357` (sync trigger only on `reports`→`shared_routines`); `community_post_reports` `:389-413` has **no** count trigger; "Under Review" badge only in `RoutineCard` `app/(tabs)/explore.js:393`
- **Evidence:** `sync_report_count()` fires only on the `reports` table. `community_post_reports` has an insert policy + UNIQUE dedupe but no trigger to increment `community_posts.report_count`. The client badge renders only in `RoutineCard`; `DeepWorkCard`/`WorkoutCard`/`MealDayCard` never render it. `reported_posts_admin` joins `shared_routines` only.
- **Impact:** Reporting a deep-work/workout/meal-day post increments nothing, shows nothing, and never reaches the moderator's review view — undermining the 1.2 "act on reports" requirement for three of the four post types.
- **Scenario:** A user reports an abusive meal-day caption; the row lands in `community_post_reports`, `report_count` stays 0, no badge shows, and the admin view (routines-only) never lists it.
- **Fix:** Add a trigger on `community_post_reports` mirroring `sync_report_count`, add a `reported_community_posts_admin` view, render the badge in all four cards, and ideally auto-hide past a threshold.
- **Effort:** Medium · **App Store impact:** 1.2 — most reports silently dropped.
- **Verification:** **CONFIRMED.** Correction: reports are *retained* in the table (queryable manually), but the automated/surfaced moderation pipeline is broken for 3 of 4 UGC types.

---

### 🟡 MEDIUM

#### M-1 · `moderate_image` (and dead `moderate_text`) bypass all rate limits — Supabase compute/quota abuse (originally flagged High "cost-DoS")
- **Confidence:** Verified · **Dimension:** reliability / cost-abuse · **Location:** `openai-proxy/index.ts:17-22, 109, 115-121`
- **Evidence:** `moderate_image` and singular `moderate_text` are in none of the three limit sets, so the rate-limit block is skipped entirely for them. `moderate_image` sends `body.base64` with no size cap.
- **Impact / correction:** The verifier **downgraded this from High to Medium**: `moderate_image` calls OpenAI's `moderations` endpoint (`omni-moderation-latest`), which is **free**, so the "unbounded OpenAI bill-shock" framing is wrong. The real residual risk is unbounded Supabase Edge-Function compute + egress (large base64 per call) and OpenAI moderation-quota exhaustion — and it is inconsistent with the author's own design (they explicitly capped the sibling free `moderate_texts` "so a scripted caller can't hammer them"). `moderate_text` (singular) is effectively **dead code** — no client calls it.
- **Fix:** Add `moderate_image` to a per-day cap (share `ai_mod_limits`), reject oversized base64, and remove `moderate_text` if unused.
- **Effort:** Small · **Verification:** **PARTIALLY_CONFIRMED** (mechanically true; severity/impact corrected).

#### M-2 · No payload-size limit on base64 image inputs (`analyze_looks`, `extract_workout`, `moderate_image`)
- **Confidence:** Verified · `openai-proxy/index.ts:115-118, 262-277, 301-310` — `extract_workout` caps count (`.slice(0,4)`) but not per-image bytes, all sent `detail:'high'` (most expensive vision tier); the others have no length check. **Fix:** reject base64 over ~1.5 MB decoded and prefer `detail:'low'`. Compounds M-1. **Effort:** Small.

#### M-3 · `profiles.bio` / `name` / `username` are directly writable and world-readable with no server-side moderation
- **Confidence:** Verified · `lib/profileStorage.js:39-84`; `assert_text_clean` trigger is attached only to `shared_routines`/`community_posts`, not `profiles`. A user can set an offensive bio/name/username that is exposed to all signed-in users via `public_profiles` and copied verbatim into post headers. **Fix:** add a `BEFORE INSERT OR UPDATE` trigger on `public.profiles` running `assert_text_clean` on name/username/bio + length caps. UGC gap (1.2). **Effort:** Small.

#### M-4 · `profiles.avatar_url` accepts arbitrary URLs — tracking-pixel / IP-logging vector on profile views
- **Confidence:** Likely · `lib/profileStorage.js:39-52` — no constraint ties `avatar_url` to the app's own bucket; `public_profiles` exposes it and it renders as `<Image source={{uri}}>`. Same class the team patched for the *feed* author avatar, still open on the *profile* row. A user can set `avatar_url` to an attacker host and log the IP/UA of everyone who views their profile. **Fix:** validate server-side (BEFORE trigger/CHECK) that `avatar_url` is under the app's `avatars` public-URL prefix. **Effort:** Small.

#### M-5 · `assert_text_clean` blocklist is trivially bypassable (no normalization) — and it is the only guaranteed text backstop
- **Confidence:** Verified · `supabase/schema.sql:188-235` — only `lower()` + literal ASCII `strpos`/word-boundary matches. No de-leet, diacritic folding, zero-width/space stripping, or homoglyph handling, so `f u c k`, `sh1t`, `n1gger`, Cyrillic homoglyphs all pass. Because the OpenAI moderation passes fail open on exception and past the mod cap, this is the *only* guaranteed server filter. **Fix:** normalize (casefold + strip combining marks + collapse internal separators + map leet digits) before matching; keep AI moderation as defense-in-depth but don't rely on its fail-open path. **Effort:** Medium.

#### M-6 · `report_count` is never incremented — the sync trigger's UPDATE is blocked by RLS
- **Confidence:** Likely · `supabase/schema.sql:342-357` — `sync_report_count()` is a plain (SECURITY INVOKER) trigger running as the reporting user; `shared_routines` has no UPDATE policy, so under RLS the `UPDATE … report_count` matches zero rows silently. Result: `report_count` stays 0 for every post, so `reported_posts_admin`'s `ORDER BY report_count DESC` and the "Under Review" threshold are meaningless, and there is no auto-takedown. **Fix:** make `sync_report_count` SECURITY DEFINER (or add a scoped UPDATE policy) and add threshold-based auto-hide. *Recommend a quick live test to confirm (could not execute SQL).* **Effort:** Small.

#### M-7 · Data-load failures leave the largest screens permanently blank or spinning (no catch / error / retry state)
- **Confidence:** Verified · `app/routine/[name].js:1636-1690` (also `(tabs)/index.js:1180-1221`, `(tabs)/calendar.js:334-377`, `day-detail.js:132-155`) — `load` awaits `Promise.all(...)` with no try/catch/finally; if any Supabase call rejects, `setLoading(false)` is never reached and the screen stays on the loading blank/spinner forever, with no error and no retry. **Fix:** wrap each load in try/catch, clear loading in `finally`, render an error state with Retry. **Effort:** Medium.

#### M-8 · Objectionable content is never auto-hidden and there is no published 24h action commitment
- **Confidence:** Verified · `app/(tabs)/explore.js:393-397` (badge only) — at `report_count>=5` the post shows a non-blocking "Under Review" badge but stays fully visible; takedown is manual via the `reported_posts_admin` SQL view; no in-app community guidelines or "we act within 24h" statement. Apple 1.2 expects timely removal + a stated commitment. **Fix:** auto-hide past a threshold, give moderators an in-tool takedown + user-eject path, and add a visible 24h-review commitment + community guidelines. **Effort:** Medium.

#### M-9 · Profile visibility ("Show full data to") control is disabled in the UI — users cannot make their data private
- **Confidence:** Verified · `app/(tabs)/settings.js:452-477` — the visibility picker is wrapped in `{false && ( … )}`. `visibility` defaults to `'friends'` and is still written on save, but there is no reachable UI to change it to `'none'` or `'everyone'`. RLS enforces visibility correctly, so this is a control-availability gap, not exposure. **Fix:** remove the `false &&` guard now that RLS enforcement exists (or intentionally ship friends-only and delete the dead code). **Effort:** Trivial.

#### M-10 · Timed-exercise sets have three incompatible data conventions across writer and readers
- **Confidence:** Verified · writer `app/workout-run.js:109` writes `{reps, weight}` (no `time`/`unit`) and never persists the run-time time/weight toggle; `day-detail.js:305-307` reads `set.time`/`set.unit`; the routine history modal `[name].js:1249` reads a timed value from `st.weight`. A logged plank shows "—" in Day Detail; `unit` always defaults to `lb`. **Fix:** standardize one logged-set shape (`{reps, weight, time?, unit, isTime}`) and persist the toggle. **Effort:** Medium.

#### M-11 · Workout elapsed-timer interval is never cleared on unmount
- **Confidence:** Verified · `app/workout-run.js:93` — `setInterval` is cleared only in `finishWorkout`/Exit, with no `useEffect` cleanup (unlike the rest-countdown at L82). Leaving mid-session via Android back/gesture leaks the 1s interval and fires `setState` on an unmounted component. **Fix:** `useEffect(() => () => { clearInterval(elapsedRef.current); clearInterval(intervalRef.current) }, [])`. **Effort:** Trivial.

#### M-12 · `setup-routine` screen ignores dark mode (hardcoded light palette)
- **Confidence:** Verified · `app/setup-routine.js` never imports `useTheme`; `page` bg `#f6f7fb`, title `#111`, inputs `#fff`. In dark mode the entire routine editor renders as a bright white screen. **Fix:** thread `useTheme()` / a `makeStyles(theme)` factory. **Effort:** Medium.

#### M-13 · Multi-table routine/workout rename is non-atomic with no rollback → partial failure orphans history
- **Confidence:** Verified · `lib/storage.js:141-174, 495-523` — `renameRoutine`/`renameWorkoutPlan` update `routine_names`/templates then separately update history/log rows and AsyncStorage keys; if a later step fails, history stays keyed to the old name and detaches from streak/calendar. **Fix:** perform the rename in a single SECURITY DEFINER RPC/transaction, or make it idempotent + retried. **Effort:** Medium.

#### M-14 · Unguarded `JSON.parse` in `getRoutineSettings` / `getHiddenDefaults` breaks routine loading + notifications on corrupt data
- **Confidence:** Verified · `lib/storage.js:255-258, 268-279` — these two getters (unlike every other in the file) don't wrap `JSON.parse` in try/catch, so a truncated AsyncStorage value throws on every load; `getRoutineSettings` feeds routine screens + `syncRoutineNotifications`, so one bad entry can break display and cancel all reminders. **Fix:** wrap both in try/catch returning defaults. **Effort:** Trivial.

#### M-15 · Meals & saved-meals RMW on a single Supabase row → concurrent adds drop a meal (originally flagged High "whole-array races")
- **Confidence:** Verified · `lib/storage.js:690-699` (saveMeal), `662-668` (upsertSavedMeal) — the entire array lives in one Supabase row (`upsert({user_id, date, meals})`); two overlapping saves clobber each other across devices. **Correction from verification:** the sibling `saveTask`/`saveScheduleItem`/`saveCalendarEvent`/`saveJournalEntry` upsert **per-row** on the backend, so those are *not* subject to sibling clobber (only their transient AsyncStorage cache is) — the original High "whole-array" finding was **downgraded to Medium** and scoped to just the two meal tables. **Fix:** one row per meal id, or serialize writes per key. **Effort:** Medium.

#### M-16 · `_updateStreak` read-modify-writes the streaks row → concurrent completion + toggle can double-count or clobber
- **Confidence:** Verified · `lib/storage.js:1177-1187`, called from both `completeRun` and `quickCheckToggle`. The `lastDate === date` guard only helps if the prior write already landed; concurrent calls both read the old `lastDate`, both compute `current+1`. **Fix:** increment atomically via an RPC. **Effort:** Small.

#### M-17 · Missing peer dependencies (`expo-font`, `expo-constants`, `expo-linking`) risk a standalone-build crash
- **Confidence:** Likely · `package.json:5-35` doesn't declare them though `expo-router`/`@expo/vector-icons` require them; `expo-doctor` reports them missing ("may crash outside Expo Go"). In a signed App Store/TestFlight build (not Expo Go) an absent native module can crash router/font init on launch. **Fix:** `npx expo install expo-font expo-constants expo-linking`, rebuild, re-run `expo-doctor`. **Effort:** Trivial · **App Store impact:** 2.1 crash-on-launch if the standalone build fails to resolve them. *This is effectively a launch blocker for a real build even though it can't be observed in Expo Go.*

#### M-18 · Unused microphone permission + duplicate Android permissions (originally flagged High)
- **Confidence:** Verified · `app.json:19-24, 34-46` — no audio feature exists (no `expo-av`/`expo-audio`), but both `expo-camera` and `expo-image-picker` inject `NSMicrophoneUsageDescription` by default (no `microphonePermission:false`), and `android.permissions` lists `CAMERA`/`RECORD_AUDIO` **twice** each. **Downgraded High→Medium** by verifier (extra purpose strings are a plausible 2.5.1/5.1.1 clarification trigger, not a guaranteed blocker; the App Privacy label is a separate manual questionnaire). **Fix:** pass `microphonePermission:false` to both plugins, `recordAudioAndroid:false` to expo-camera, and reduce the Android array to `["android.permission.CAMERA"]`. **Effort:** Trivial.

#### M-19 · Conflicting `NSCameraUsageDescription` — barcode scanner shows the "skin analysis" prompt
- **Confidence:** Verified · `app.json:35-46` — `expo-camera` sets "…scan food barcodes" and `expo-image-picker` (listed later, wins the merge) sets "…take a photo for AI skin analysis." The single Info.plist camera string ends up as the skin-analysis text, so the barcode scanner (`BarcodeScanner.js`) prompts users with the wrong purpose. **Fix:** set one accurate `NSCameraUsageDescription` via `ios.infoPlist` covering both barcode scanning and photos. **Effort:** Trivial. *(Note: the separate claim that the strings describe a "non-existent" feature was **refuted** — see R-1.)*

---

### 🟢 LOW

- **L-1 · Google/Apple id-token sign-in performed without a nonce** (Verified, `lib/AuthContext.js:113-126`). `signInWithIdToken` is called with no `nonce`, so Supabase validates only signature/audience/expiry; a leaked/intercepted id_token is replayable for its validity window. PKCE partly mitigates code interception. **Fix:** generate a raw nonce, pass its SHA-256 to the provider request, pass the raw nonce to `signInWithIdToken({ nonce })`. **Effort:** Small.
- **L-2 · Password reset allows min-6 while signup requires min-8; both client-only** (Verified, `app/(auth)/forgot-password.js:33` vs `signup.js:66`). Effective minimum is the Supabase project setting. **Fix:** raise reset to ≥8 and set the authoritative minimum server-side in Supabase Auth. **Effort:** Trivial.
- **L-3 · Custom scheme `productivityapp` for OAuth return is hijackable on Android** (Inferred, `app.json:8`). No App Links/`autoVerify`; a second app can register the same scheme and race the OAuth redirect. Compounds L-1. **Fix:** use Android App Links / iOS Universal Links for OAuth returns + implement the nonce. **Effort:** Medium.
- **L-4 · SECURITY DEFINER helpers missing `SET search_path`** (Verified, `schema.sql:472-482, 628-639, 730-736`). `is_friend`, `can_view_data`, `recent_post_count` lack a pinned search_path (unlike the other definer functions). Tables are schema-qualified so exposure is low, but these gate all cross-user visibility. **Fix:** `SET search_path = public`. **Effort:** Trivial.
- **L-5 · `reports.reported_user_id` is client-supplied and unvalidated** (Verified, `schema.sql:313-334`). Not tied to the routine's real owner; low impact today (aggregation keys off `shared_routine_id`) but poisonable if per-user report aggregation is added. **Fix:** populate it in a BEFORE trigger from the referenced post. **Effort:** Small.
- **L-6 · Sign-up account is created even when the profile write fails; confirm-time profile errors swallowed** (Verified, `lib/AuthContext.js:80-101`). A username race leaves a dangling auth user with no profile; `confirmSignUp` `catch {}` hides the cause. Not a privilege issue (UNIQUE + RLS hold). **Fix:** surface the failure and route to a "finish your profile" state. **Effort:** Small.
- **L-7 · `photoStorage` index RMW race + uncaught index write can orphan photo files** (Verified, `lib/photoStorage.js:22-41`). Concurrent saves race the index map; a failed index write after `copyAsync` leaves an unreferenced file with no cleanup. **Fix:** serialize index updates + reconcile/rollback. **Effort:** Small.
- **L-8 · `getProductivitySessions` caps local cache at ~200; older sessions exist only in Supabase but are never read** (Likely, `lib/productivityStorage.js:12-20, 47-52`). Local-first read means sessions past ~200 are invisible in-app. **Fix:** paginate reads through Supabase when the requested limit exceeds the cache. **Effort:** Small.
- **L-9 · `addFriendByCode` TOCTOU can create duplicate friendship rows** (Likely, `lib/friendsStorage.js:12-20, 58-77`). Simultaneous mutual adds both pass the existence check; no unique constraint on the unordered pair. **Fix:** DB unique constraint on `least/greatest(id1,id2)`. **Effort:** Small.
- **L-10 · Dead/disabled feature code behind `false &&`** (Verified, `app/(tabs)/index.js:1366, 1445`; `calendar.js:701-702`; `settings.js:452-453`). `ProductivityCard`, `WeeklyGoalsList`, the entire calendar "tasks" view (~300 lines), and the visibility picker are defined but unreachable — bundle bloat + maintainer confusion. **Fix:** wire to a real feature flag or delete. **Effort:** Small.
- **L-11 · Data-model drift `timeGoalSecs` vs legacy `timeGoalMins` bridged inline in ~10 sites** (Verified, `[name].js:1549` + 6 more, `setup-routine.js:227,243`). Any new read site that forgets the `?? (mins*60)` bridge mis-handles old records. **Fix:** one-time migration or a single `taskGoalSecs(t)` helper. **Effort:** Small.
- **L-12 · Profile bio save failure silently swallowed** (Verified, `app/(tabs)/explore.js:640`, `try { await updateBio(...) } catch {}`). Representative of the broader empty-catch pattern. **Fix:** surface failures / revert optimistic UI. **Effort:** Trivial.
- **L-13 · No in-app data export** (Verified, `settings.js` — deletion present, export absent). Not required by Apple but expected under GDPR/CCPA access rights for this much personal data. **Fix:** add an "Export my data" JSON share-sheet. **Effort:** Small.
- **L-14 · Age gate is client-side only and skippable** (Verified, `app/onboarding.js:216`; `handleSkip` at `:169-176`). The 13+ check gates only the body-stats step; "Skip for now" bypasses it. Backed by a server-side `age >= 13` CHECK for *stored* data and by the App Store Connect age rating, so minor. **Fix:** present a neutral age gate before onboarding can be skipped, or rely on the age rating. **Effort:** Small.

---

### ⚪ INFO / Correctly-handled (flagged so they're not mistaken for gaps)

- **I-1 · Client `consumeRateLimit` is a non-atomic, resettable AsyncStorage counter** (`lib/rateLimit.js:18-48`) — races and is bypassable by clearing app storage. **Acceptable** because the Edge Function enforces the real server-side limit (see H-1 for that limit's own issue). It is a UX affordance, not a security boundary.
- **I-2 · No app-level Privacy Manifest (`PrivacyInfo.xcprivacy`) in source** (Inferred, `app.json:11-15`) — Expo SDK 54 prebuild aggregates per-library manifests (async-storage, expo-file-system, RN) covering the common required-reason APIs (UserDefaults, file timestamp), so this is *likely* handled, but not verifiable in-repo. **Verify after `expo prebuild`** that `ios/*/PrivacyInfo.xcprivacy` exists; if any app-specific required-reason API is used, add `ios.privacyManifests` to `app.json`. Risk if missing: ITMS-91053 on upload.
- **I-3 · Dependency patch drift** (Verified, `package.json:9,19`) — `expo` 54.0.34 vs 54.0.36, `expo-router` 6.0.23 vs 6.0.24. Not a rejection cause; run `npx expo install --fix` before cutting the release.
- **I-4 · `openai-proxy` 500 handler echoes upstream error text to the client** (`index.ts:327`, `message: String(e.message)`). The OpenAI key is never in that message (only OpenAI's `error.message` is thrown), so **no key leak** — but echoing upstream text is worth suppressing. **Effort:** Trivial.
- **I-5 · Confirm-email is a Supabase dashboard setting, not enforced in code.** The code handles both states correctly; if the project has "Confirm email" **off**, password signups skip verification. Verify the dashboard setting before launch.

---

### ✅ REFUTED during verification (do **not** action these)

- **R-1 · "Camera/photo permission strings describe a non-existent AI skin analysis feature"** → **REFUTED.** The AI skin/hair analysis feature **is real** (`app/routine/[name].js:616,633,645-683` — camera/library → `analyze_looks` → skincare steps; UI literally "Analyze my skin and hair with AI"). The `app.json:43-44` strings are **accurate as written**. The original finder overlooked this feature (it only saw the text-only `LooksSurveyModal.js`). Applying the proposed "fix" would make the string *less* accurate. *Only optional polish: the shared string names the skin-analysis use but not the incidental avatar/workout uses — not required and not a rejection driver.* **(The separate `NSCameraUsageDescription` merge conflict in M-19 is still valid and unrelated.)**
- **R-2 · "CI unsigned IPA means there is no App Store submission path"** → **REFUTED.** The unsigned GitHub workflow is an **intentional, documented AltStore sideload lane** (its own header says so). The real store path is **EAS Build + `eas submit`**: iOS distribution signing is managed server-side by EAS (correctly absent from `eas.json`), and an empty `submit.production: {}` is a valid EAS Submit config. Residual (info-level) note: wire Apple credentials / an ASC API key into EAS before the first non-interactive submit, and document the EAS store path in-repo.

---

## 4. Security Assessment

**Is security enforced by the backend, not the UI? — Mostly yes, verified.** RLS is on every table and keyed to `auth.uid()`; the `FOR ALL USING(...)` policies without an explicit `WITH CHECK` are safe because Postgres reuses `USING` as the insert/update check (confirmed). Cross-user reads go through `can_view_data()`/`is_friend()`; the client `canView` is a mirror, not the gate. The Edge Function authenticates the JWT before every action and holds all real secrets. The `security-fixes.sql` history shows the team found and fixed genuine authz bugs (friendship self-accept, profile over-exposure, author spoofing) — a good signal.

**Where backend enforcement is missing or weak:**
1. **Image/avatar UGC has no server-side moderation** (H-6) — the only UGC class with no DB/Storage backstop; fails open and is bypassable by a direct upload.
2. **`profiles` text fields have no moderation trigger** (M-3) — unlike feed content.
3. **The AI cost cap is not atomic** (H-1) — the sole server-side cost control is defeated by concurrency.
4. **`avatar_url` and the blocklist normalization** (M-4, M-5) — an IP-logging vector and a trivially-obfuscated-text bypass remain.
5. **SECURITY DEFINER search_path hygiene** (L-4) — low, but inconsistent with the rest of the file.

**Secrets & supply chain:** Clean. Only the publishable anon key ships; the OpenAI + service-role keys are server-only; no secrets in git history; `.env` committed intentionally holds only public values. All 22 npm-audit vulnerabilities (`tar` critical, `undici`/`postcss`/`shell-quote`/`js-yaml`/`brace-expansion` high, plus `@expo/*`) are **build-tooling / dev dependencies** — none ship in the runtime Hermes bundle, so their **real relevance to end users is low** (they are a build-machine/CI hardening concern, not an app vulnerability).

**Auth:** Solid session storage (SecureStore), correct OAuth id-token pattern except the missing nonce (L-1) and Android scheme hijack (L-3). No privilege-escalation path found; account deletion is complete and self-scoped.

---

## 5. Vibe-Coded / Maintainability Assessment

**Engineering maturity: 6.5 / 10. Vibe-coded risk: Moderate.**

This is **not** chaotic AI-splatter. The evidence *against* uncontrolled vibe-coding is strong and specific: a deliberate RLS model on every table, a security-fixes migration that reads like a real pen-test remediation, server-side identity binding, disciplined secret handling, exact client↔DB blocklist parity, correct DST-safe date math, clean `tsc`, a successful production export, and consistent theming across most screens. Several finder passes explicitly noted "no client-side security decisions standing in for backend enforcement."

The evidence *for* moderate risk is concentrated, not pervasive, and clusters in two areas:
- **Client data layer (`lib/storage.js`)** — a systemic pattern of read-modify-write on whole collections/blobs (H-4, M-15, M-16), silent `catch {}` on the only durable writes (H-3), local-first reads that never re-sync (H-2), and two getters missing the try/catch that every sibling has (M-14). These read like features added quickly without a durability/sync strategy.
- **UGC-moderation completeness** — text is well-guarded but images aren't (H-6), community-post reports are inert (H-8), and blocking is absent (C-2). The moderation system was clearly designed but left asymmetric/unfinished.

Other maintainability smells: substantial dead code behind `false &&` (L-10), incomplete data-model migrations bridged inline in ~10 places (L-11, M-10), one screen not theme-aware (M-12), and `Alert.prompt` used where a cross-platform modal was needed (H-5). These are "unfinished refactor / built-fast" signals rather than hallucinated APIs — notably, the audit found **no hallucinated/misused RN or Expo APIs** in the reviewed files, and the biggest file (`routine/[name].js`, 3,252 lines) is large but internally organized.

Net: a security-first author who moved fast on the client persistence layer and left the moderation and legal surfaces unfinished. Fixable without rearchitecting.

---

## 6. Reliability & Performance Assessment

The reliability posture is the weakest dimension and the main reason for "moderate" maturity:
- **Data durability:** silent write-failure loss (H-3) + local-first no-resync (H-2) mean cloud data can silently diverge or be lost on reinstall. This is the highest-user-impact cluster.
- **Concurrency:** RMW races on routine runs/streaks (H-4, M-16) and meals (M-15) can corrupt history/streak percentages and drop items on ordinary rapid taps.
- **Error/empty/retry states:** the four largest screens have **no error state** — a single load rejection leaves a permanent blank/spinner with no retry (M-7). Empty/loading states otherwise exist (calendar/day-detail are the most polished).
- **Resource cleanup:** one leaked interval on unmount (M-11); other timers/subscriptions are cleaned up correctly (`ProductivityContext`, `sectionsStorage`, auth subscription).
- **Crash risk:** unguarded `JSON.parse` on corrupt storage (M-14) and the missing peer deps (M-17) are the two concrete crash vectors.
- **Performance:** no obvious render-storm or listener-leak epidemic was found; the concern is correctness under concurrency, not raw perf.

Positive: the productivity timer derives its saved value from timestamps (background-safe), streak/date math is DST-safe, and `saveMeal`/`deleteMeal` correctly surface errors (the right pattern the rest of the file should adopt).

---

## 7. App Store Readiness Checklist

| Requirement | Status | Reference |
|---|---|---|
| Release JS bundle builds | ✅ Pass (`expo export`, 6.36 MB, exit 0) | §9 |
| Standalone build won't crash on launch | ⚠️ **At risk** — missing peer deps | M-17 |
| Privacy Policy (functional, in-app + URL) | ❌ **Blank stub** | C-1 |
| Terms / EULA | ❌ **Blank stub** | C-1 |
| Permission purpose strings accurate | ⚠️ Camera prompt conflict (barcode shows skin text); mic unused | M-19, M-18 |
| Only permissions actually used | ⚠️ Unused microphone + duplicate Android perms | M-18 |
| Privacy Manifest / required-reason APIs | ⚠️ Likely auto-covered by Expo; **verify post-prebuild** | I-2 |
| Sign in with Apple parity (4.8) | ✅ Apple + Google shown together on iOS | `login.js:87-89` |
| In-app purchases / Restore Purchases | ✅ N/A — no IAP/subscriptions in code | verified |
| In-app account deletion (5.1.1(v)) | ✅ Present & reachable | `settings.js:853` → `delete_own_account` |
| App Tracking Transparency / IDFA | ✅ N/A — no analytics/ads/tracking SDK | verified |
| UGC: content filter | ✅ Word blocklist + AI moderation (text) | `explore.js`, `schema.sql` |
| UGC: flag/report | ✅ Present (⚠️ inert for 3 of 4 post types) | H-8 |
| UGC: **block abusive users** | ❌ **Absent** | C-2 |
| UGC: developer acts on reports | ⚠️ Manual SQL only; no auto-hide, no 24h commitment | M-8 |
| UGC: image moderation enforced | ❌ Client-side, fails open | H-6 |
| Third-party data sharing disclosed (OpenAI, face photos) | ❌ Undisclosed | H-7, C-1 |
| Age gate | ⚠️ Client-side skippable; server floor for stored data | L-14 |
| Placeholder/broken flows | ❌ Blank legal screens; ⚠️ dead code | C-1, L-10 |
| Store submission pipeline | ✅ EAS Build + Submit is the path (⚠️ wire Apple creds) | R-2 |

### App Privacy questionnaire — categories implied by the code (for App Store Connect)
- **Health & Fitness** (weight, height, workouts, meals) — linked to identity.
- **Contact Info** (email, name).
- **User Content** (photos: avatar + face selfie + workout photos; free-text bio, routines, posts).
- **Identifiers** (account/user ID).
- **Sensitive Info** — face photos processed by OpenAI; consider the "Sensitive Info" category and disclose the OpenAI processor.
- **Data Used to Track You:** **None** (no tracking SDK) — declare tracking = No.
- **Data linked vs not linked:** most data is linked to the account. Face photos are *transmitted but not stored* — disclose as "collected/transmitted, not retained."

---

## 8. Commands Run & Results

| Command | Result |
|---|---|
| `npx eas-cli whoami` | `shreyj7` (logged in) |
| `git status --short` / `git log` | Clean tree; on `main`; `.env` tracked (public values only); `.env.local` + `supabase/.temp` **never committed** (verified via `git log --all`) |
| `npm audit --json` | 22 vulns (1 critical `tar`, 5 high `undici`/`postcss`/`shell-quote`/`js-yaml`/`brace-expansion`, 16 moderate) — **all build-tooling/dev deps**, none in the runtime bundle |
| `npx tsc --noEmit` | **Exit 0.** Only errors are the Deno edge-function file (`Cannot find name 'Deno'`, esm.sh import) — expected false positives from the RN tsconfig; app code type-checks clean |
| `npx expo-doctor` | 16/18 pass. **Fail:** missing peer deps `expo-font`/`expo-constants`/`expo-linking` (M-17); patch drift `expo` 54.0.34→36, `expo-router` 6.0.23→24 (I-3) |
| `npx expo export --platform ios` | **Exit 0.** Built `entry-*.hbc` (6.36 MB Hermes bytecode) + assets to `dist/` — production JS bundle compiles cleanly |
| Grep: analytics/tracking/ads SDKs | **None** (only emoji keyword + habit-tracking UI copy) |
| Grep: IAP/subscription/paywall | **None** (only auth-state `subscription` + a blocklist word) |
| Grep: `console.*` | 3 total — 2 in a dev script, 1 in `workout-library.js`; **no PII logging** |
| Grep: `*.xcprivacy` / tracking in `app.json` | No app-level privacy manifest in source; no `NSUserTracking`/`infoPlist` block |

**Could not test (stated honestly):** live SQL execution (RLS/trigger behavior for M-6 report_count is asserted from Postgres semantics, recommend a quick live insert test); runtime concurrency timing (RMW races are inferred from code structure, not reproduced); a real signed device build (crash risk M-17 and privacy-manifest aggregation I-2 are from source + toolchain, not a device run); the Supabase "Confirm email" dashboard setting (I-5); actual OpenAI moderation efficacy; whether a human monitors `reported_posts_admin`.

---

## 9. Prioritized Remediation Plan

### A. Immediate security / cost blockers (do first — cheap, high leverage)
1. **H-1** — Make the AI rate-limit atomic (`INSERT … ON CONFLICT … DO UPDATE SET count = count+1 RETURNING count`). *Restores the only paid-AI cost control.* (Small)
2. **M-1 + M-2** — Cap `moderate_image` (and remove dead `moderate_text`); reject oversized base64 on all image actions. (Small)
3. **H-6** — Enforce avatar/image moderation server-side (Storage/Edge trigger or gate `avatar_url` on a moderation record); stop failing open. (Medium)
4. **M-4** — Constrain `avatar_url` to the app's own bucket prefix (kills the IP-logging vector). (Small)
5. **L-4** — Add `SET search_path = public` to `is_friend`/`can_view_data`/`recent_post_count`. (Trivial)

### B. Required before App Store submission (launch blockers)
1. **C-1** — Real Privacy Policy + Terms (in-app + public URL + App Store Connect), disclosing OpenAI processing and the 13+ floor; EULA with a 1.2 zero-tolerance clause. **(Hard blocker.)**
2. **C-2** — Add **Block user** (table + client filter + server-side feed exclusion). **(Hard blocker.)**
3. **M-17** — Install the missing peer deps and rebuild; verify no crash on a standalone build. **(Crash blocker.)**
4. **H-7** — Amend the skin-analysis disclaimer to name OpenAI + one-time/not-stored + explicit consent.
5. **H-8 + M-8** — Wire `community_posts` report_count trigger + admin view + badges in all cards; auto-hide past a threshold; add community guidelines + a 24h-review commitment.
6. **M-19 + M-18** — One accurate `NSCameraUsageDescription`; `microphonePermission:false`; de-duplicate/trim Android permissions.
7. **M-6** — Fix `report_count` increment (SECURITY DEFINER) so moderation ordering works.
8. **M-3** — Add the `assert_text_clean` trigger to `profiles` (bio/name/username).
9. Complete the **App Privacy questionnaire** per §7; verify the Privacy Manifest post-prebuild (I-2); confirm "Confirm email" is on (I-5).

### C. Recommended before launch (quality / reliability)
1. **H-2 + H-3** — Add cold-start/foreground Supabase re-sync and a dirty-flag + retry queue (or at least a sync-failed indicator). *Biggest user-trust improvement.*
2. **H-4 + M-15 + M-16** — Optimistic + debounced/serialized (or RPC-atomic) writes for checkbox toggles, meals, and streaks.
3. **H-5** — Replace `Alert.prompt` with a cross-platform modal (unblocks Android workout create/rename).
4. **M-7** — Add error + retry states to the four large screens.
5. **M-14** — Guard the two unguarded `JSON.parse` calls.
6. **M-5** — Normalize before blocklist matching.
7. **M-9** — Re-enable the visibility picker (RLS already enforces it).
8. **M-13** — Make routine/workout rename atomic.
9. **L-1 + L-3** — Add the OAuth nonce; move OAuth returns to App/Universal Links.
10. **M-12** — Theme the `setup-routine` screen.

### D. Post-launch improvements
- L-13 data export; L-8 productivity-session pagination; L-10 remove dead code; L-11 data-model migration + helper; L-2 password-min parity; L-5 server-set `reported_user_id`; L-6/L-12 surface swallowed errors; L-7/L-9 photo-index & friendship dedupe; M-10 unify timed-set shape; I-4 suppress upstream error echo; I-3 patch-version alignment.

---

## 10. Final Decision

### Original verdict (pre-fix): `SUBMIT AFTER LISTED BLOCKERS ARE FIXED`

In its state at audit time the app was a **DO-NOT-SUBMIT**: the blank Privacy Policy/Terms (C-1) and the absent block-user control (C-2) were near-certain App Store rejections, and the missing peer dependencies (M-17) a real crash-on-launch risk in a non-Expo-Go build. None were architectural — all were well-scoped fixes.

### Current verdict (post-fix): `READY FOR TESTFLIGHT ONLY` → submit after deploying the backend

Every code-level blocker in this report is now fixed and verified building (§0). What stands between the app and submission is no longer code — it is **deployment and manual confirmation**:

1. **Apply `supabase/audit-fixes.sql` and redeploy the `openai-proxy` edge function.** These are hard prerequisites, not cleanup: the edge function fails closed on the new rate-limit RPC, and avatar uploads now require the new server-side action while the migration revokes direct bucket writes. Until both ship, AI features and avatar upload will not work.
2. **Smoke-test on a real device after deploying** — create an AI routine, upload an avatar, block a user, report a post, rename a workout, and confirm data survives a background/foreground cycle. The data-layer changes are extensive and have not been exercised at runtime.
3. **Host the privacy policy at a public URL** and put it in App Store Connect (the in-app screen is now real, but Connect needs a URL too).
4. **Confirm the manual items**: privacy manifest after `expo prebuild` (I-2), Supabase "Confirm email" setting (I-5), and Apple credentials wired into EAS for `eas submit` (R-2).

**TestFlight is viable now.** Internal TestFlight testing should happen before submission regardless, given the size of the data-layer change.

**No guarantee of approval is implied** — App Review depends on reviewer discretion, the final binary, Connect metadata, and the App Privacy questionnaire, none of which can be verified from the repository.

> **No guarantee of approval is implied.** App Review outcomes depend on reviewer discretion, the final built binary, App Store Connect metadata, and the App Privacy questionnaire — several of which (privacy manifest aggregation, the "Confirm email" setting, EAS signing credentials, live RLS trigger behavior) **could not be verified from the repository** and must be confirmed manually before submission.

---
*Report generated by static analysis + multi-agent adversarial review. No code was modified; no destructive, deploy, or credential actions were taken. Any secrets encountered were redacted. Findings are the auditor's assessment for authorized production-readiness review.*
