# PostHog on an app that holds donor records (THE-36)

Harvest stores donor names, giving history, member emails and phone numbers,
prayer requests and private messages. Product analytics on top of that is not a
neutral addition — most of its defaults point at exactly that data. This
documents what was installed, what was refused, and what is left for the founder
to do.

Nothing in this PR sends anything. `NEXT_PUBLIC_POSTHOG_KEY` is not set, so
PostHog does not load, does not initialise, and does not throw. The install is
inert until the project exists.

## What was installed

One dependency, `posthog-js`, by hand.

**`@posthog/wizard` was NOT run**, on purpose. It is an interactive CLI that
rewrites files, and two things about this codebase make that dangerous rather
than merely untidy:

1. It turns session replay on. On `/admin/crm` that records donor names, giving
   amounts, emails and phone numbers; on the member app it records prayer
   requests and private messages.
2. It would inject a provider into `src/app/layout.tsx` — 302 lines carrying the
   pre-paint theme script, a raw string that runs before any bundle loads and
   whose own comment describes "exactly one moment where `<html>` goes from
   unstamped to fully stamped". Four PRs went into getting it right.

| File | What it is |
|---|---|
| `src/lib/analytics/events.ts` | The closed vocabulary: every event name and property key that may be sent, and the enumerated field labels that may never be |
| `src/lib/analytics/config.ts` | The `posthog.init()` options and `before_send`, the one choke point every event passes through |
| `src/lib/analytics/identity.ts` | Who an event belongs to, and which church it counts towards |
| `src/lib/analytics/client.ts` | The runtime. The only module that loads the SDK, and it does so dynamically |
| `src/components/AnalyticsBridge.tsx` | Where it starts: inside `App.tsx`'s router, never in `layout.tsx` |

`src/app/layout.tsx` is unchanged, byte for byte, and a hash pin in
`posthog-untouched.test.ts` says so.

## The decisions

### 1. Session replay — off, and masked anyway

`disable_session_recording: true`.

This is not overridable from the PostHog UI. posthog-js gates the recorder on
`enabled_server_side && enabled_client_side && !isDisabled`
(`session-recording.ts`); this flag falsifies the last two, so switching replay
on in project settings does not start it here.

Masking is configured regardless, so that a future PR flipping that flag does
not leak on its first frame:

| Setting | Value | What it covers |
|---|---|---|
| `maskAllInputs` | `true` | every `<input>`, `<textarea>` and `<select>` on every screen |
| `maskTextSelector` | `'*'` | every text node on every surface — the CRM and the member app included |
| `maskAllElementAttributes` | `true` | `name`, `value`, `alt`, `title`, `src` — the half masking text does not reach |
| `enable_recording_console_log` | `false` | console output, which flattens logged objects into strings |
| `maskTextClass` / `blockClass` / `ignoreClass` | `ph-mask` / `ph-no-capture` / `ph-ignore-input` | named explicitly so a component can opt into more |

`'*'` was chosen over a CRM-and-member selector list deliberately: a selector
list depends on a marker class staying on a component through every refactor,
and the surfaces it would have to name are a 2,000-line `AdminCRM.tsx` and the
member app's message and prayer screens.

`disable_external_dependency_loading: true` is the second, independent lock —
the rrweb recorder is fetched as an external script, and this stops it being
downloaded at all. Enabling replay later therefore takes two deliberate edits,
not one.

### 2. Autocapture — off, events instrumented explicitly

`autocapture: false`.

Autocapture decides what to send by reading the DOM: element `textContent` and
input `name` attributes. On a contact form that is PII; on `/admin/crm` the
element text **is** the donor record. There is no allow-list that makes that
safe here, because the thing being allow-listed is a page whose entire content
is the data in question.

Switched off with it, because each reads the DOM the same way:
`capture_heatmaps`, `capture_dead_clicks`, `rageclick`, and — the sharpest of
them — `$copy_autocapture`, which captures the text the user copied. On the CRM
that is an admin copying a donor's email address.

`capture_exceptions` is also off. Sentry already captures exceptions here,
through `src/lib/sentry-scrub.ts`, which exists because donor metadata reaches
error strings by way of `console.error` in the webhook routes. Sending the same
strings to a second vendor with none of that scrubbing would undo it.

**What is captured instead**: `$pageview`, by hand, with two properties —
`app_surface` (`'admin' | 'member'`) and `is_platform_admin`. That is the entire
event vocabulary today. Adding to it means editing `events.ts`, which is the
point.

### 3. Hosting region — EU recommended

**Recommendation: EU cloud (`https://eu.i.posthog.com`), which is the default in
`config.ts`.**

⚠️ **The region is fixed at project creation and cannot be migrated.** Creating
the project in the wrong region means creating a second one and losing the
history in the first.

The case for EU: the customers are churches, several in the EU; the data
subjects are their members; the app already holds their names, giving history,
attendance and prayer requests. Keeping the analytics processor in the same
jurisdiction removes a transfer question from every future DPA conversation
rather than answering it. The cost is latency for non-EU churches, which for
fire-and-forget analytics beacons is not a user-visible cost.

If the founder creates a US project instead, set
`NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`. A mismatch is not silent:
`on_request_error` logs the rejection and names both variables, because "events
are 401ing" and "nobody used the product" look identical on an empty dashboard.

### 4. Identity and tenancy

**Identify by Firebase `uid`.** `distinct_id` is a person profile's primary key
in PostHog: shown on every event, searchable, present in exports, and *not*
deleted by `reset()`. 🔴 An email address there is the identifier a donor would
be recognised by, sitting in a third-party product permanently. The email is
still read locally — `isSuperAdminEmail` needs it — but never sent.

**Group by tenant** (`posthog.group('tenant', <slug>)`), so a church's usage is
separable.

**⚠️ The super-admin case.** `getTenantScope()` returns the tenant of the
subdomain you are on, for everyone, super admin included — that is correct as a
*data* boundary: on `nations.theharvest.app` a super admin reads `nations`' data
and must. Reused as an analytics group, the same correctness becomes a reporting
bug: the platform owner opening five churches in a morning is counted as an
active user of each, and the number that looks healthiest is the tenant most
likely to be in trouble.

`isPlatformContext()` and `hasPlatformOverride()` do **not** solve this. Both
return `false` for a super admin on a tenant subdomain, by design, because they
answer "should this user be plan-gated as this tenant?". The question here is
"whose usage is this?", and it is answered by the account, never by the host.

So `identity.ts` asks `isSuperAdminEmail` directly and, for a platform admin:

- does not call `getTenantScope()` at all — there is no value for a later change
  to pick up by accident;
- calls `posthog.resetGroups()` rather than merely skipping `group()`, because a
  shared church office computer carries the previous user's persisted group into
  the next session;
- sets `account_kind: 'platform_admin'`, so platform usage stays visible as
  itself and can be excluded from any product metric with one filter.

**Reset on sign-out.** `resetIdentity()` runs on every `onAuthStateChanged(null)`
— including on `/auth`, the screen sign-out lands on. It is safe there because
it acts only if analytics was already running, which can only have happened on a
surface that was not pre-auth.

### 5. Where it initialises

`src/components/AnalyticsBridge.tsx`, mounted inside `App.tsx`'s `BrowserRouter`.
Not `layout.tsx`: nothing about analytics needs to run before first paint, and
the SPA serves every non-API path from one document, so a document-level script
would see one navigation and then go quiet.

🔴 **Pre-auth surfaces gained nothing.** `/auth`, `/onboarding` and
`/church-onboarding` get no init, no identify and no pageview. Not "initialised
but configured not to look" — not initialised. They are the screens built out of
email and password inputs, and the only screens a prospective customer sees
before paying (THE-85). `PREAUTH_PATHS` is imported from `preauth-theme.ts`, not
restated, so the list cannot drift; neither it nor the pre-paint script was
touched.

**Scope, stated plainly (THE-36)**: the bridge covered the SPA shell only. The
dedicated Next routes were separate entry points and were **not** instrumented.

### 5b. THE-206 — the public routes, and the whole route map

⚠️ **THE-206 closed that gap.** The ten dedicated Next routes each mount
`PublicRouteAnalytics` (`src/components/PublicRouteAnalytics.tsx`), a
side-effect client component that fires one `$pageview` on mount. There is no
router to subscribe to — a Next page mounting IS the navigation.

🔴 **The enumeration lives in `src/lib/analytics/routes.ts`**, and a test walks
`src/app` and fails if a `page.tsx` exists that the registry does not name. That
is what stops the next route repeating this bug.

| Route | Entry | Surface | Before | After |
|---|---|---|---|---|
| `/` | SPA | member | ✅ | ✅ |
| `/admin` | SPA | admin | ✅ | ✅ |
| `/admin/[section]` | SPA | admin | ✅ | ✅ |
| `/admin/[section]/[itemId]` | SPA | admin | ✅ | ✅ |
| `/ai-assistant` | Next page | public | ❌ | ✅ |
| `/blog/[id]` | Next page | public | ❌ | ✅ |
| `/calendar` | Next page | public | ❌ | ✅ |
| `/campaign/[campaignId]` | Next page | public | ❌ | ✅ |
| `/checkin/[sessionId]` | Next page | public | ❌ | ✅ |
| `/courses/[id]` | Next page | public | ❌ | ✅ |
| `/event/[eventId]` | Next page | public | ❌ | ✅ |
| `/form/[formId]` | Next page | public | ❌ | ✅ |
| `/pledge/[campaignId]` | Next page | public | ❌ | ✅ |
| `/post/[postId]` | Next page | public | ❌ | ✅ |
| `/auth`, `/onboarding`, `/church-onboarding` | SPA | — | ❌ | ❌ **by design** |
| `/api/**` (117), `/calendar/ical`, `/manifest.webmanifest` | handler | — | n/a | n/a |

**What a path sends.** 🔴 The route PATTERN, never the resolved path:
`/form/[formId]`, not `/form/aB3xQ7nJ5kL2mZ8w`. Counts are identical — one
pattern is exactly the set of pages it matches — and no Firestore id, blog id or
check-in session id reaches PostHog. Normalisation is applied twice, because
there are two ways a path gets out:

* the `route` property, built from the literal the page passes; and
* `$current_url`, `$referrer` and `$pathname`, which posthog-js builds from
  `location.href` itself — normalised in `before_send` by extending the existing
  query-string strip. Without this half, a `route` property would have been sent
  *beside* the live path rather than instead of it.

An unrecognised path becomes `/[unrouted]` rather than being passed through.
Over-redaction is the intended failure mode, as everywhere else in this module.

⚠️ **An external referrer keeps its host and loses its path** —
`https://mail.example/read/abc` → `https://mail.example/[unrouted]`. This cannot
tell our hosts from anyone else's (churches provision custom domains), and
posthog-js records the host separately as `$referring_domain`, so attribution
still works.

**What an anonymous visitor is.** `person_profiles: 'identified_only'` means an
unauthenticated visitor gets a random device id in first-party storage and **no
stored person profile** — posthog-js marks the event
`$process_person_profile: false`. Public routes never call `identify()`, so:

* no name, no email, no uid, no tenant group;
* no `is_platform_admin` property either — nobody was identified, so the honest
  answer is "unknown", and an absent property says that where `false` would lie.
  Select public traffic with `app_surface = 'public'`; exclude platform staff
  with `is_platform_admin is not true`.

⚠️ A visitor who signed in earlier in the same browser still carries their
persisted `distinct_id`, so their blog visit is attributed to them. That is the
same person, and it is correct.

🔴 **Nothing was relaxed to get here.** `disable_session_recording` and
`disable_external_dependency_loading` are both still `true`; autocapture,
heatmaps, dead clicks, rageclicks and `$copy_autocapture` are all still off; the
vocabulary is still closed. It gained exactly one property key, `route`, by
editing `events.ts` — which is the mechanism that list exists to force.

**Weight on the public pages.** `client.ts` now imports `identity.ts`
**dynamically**, inside `identifyUser`. `identity.ts` reaches Firestore through
`tenant-scope.ts`, and `/blog/[id]` ships no Firebase at all — a static import
would have put the whole client SDK on a church's blog for a function those
pages never call. `resolveAppSurface` moved to `routes.ts` for the same reason:
it is the one thing `client.ts` needed from that module on a path with no user.

### 6. Capacitor

**It works, and it needs no different handling.**

`capacitor.config.ts` sets `server.url: 'https://theharvest.app'`, so the native
wrapper loads the production site over HTTPS rather than bundled `file://`
assets. The webview's origin is therefore an ordinary secure origin: cookies and
`localStorage` behave exactly as on the web, which is where a Capacitor PostHog
install usually goes wrong (a `capacitor://localhost` or `file://` origin, where
cookie persistence silently fails).

**Host it calls**: the ingestion host only —
`https://eu.i.posthog.com` (or the US host if that is configured). Because
`disable_external_dependency_loading` is `true`, no asset host
(`*-assets.i.posthog.com`) is contacted for recorder, surveys or toolbar
scripts. One outbound host, not three.

There is no CSP configured in `next.config.mjs`, `vercel.json` or
`src/middleware.ts`, so no `connect-src` needs widening. If one is added later,
it must include the ingestion host.

Not verified on a device: the native projects (`android/`, `ios/`) are not in
this repo, and `NEXT_PUBLIC_POSTHOG_KEY` is unset, so there is nothing to
initialise yet. The reasoning above is from the config and the SDK's behaviour,
not from a run.

**THE-206 — does the native shell need different handling?** ⚠️ **No, and the
reason is verifiable from the config rather than assumed.**

`server.url` is `https://theharvest.app`, so the webview loads the SAME Next.js
application the browser does. There is no separate native router, no bundled
`file://` build in play, and no second code path: the SPA routes go through
`App.tsx`'s `BrowserRouter` and `AnalyticsBridge`, and the ten public routes are
server-rendered pages that mount `PublicRouteAnalytics`. **Fixing the web fixed
both** — the native shell has no route-change mechanism of its own to miss.

🔴 **Still not device-verified, and this PR does not claim otherwise.** What is
established: one code path, one router, one origin, and the same `$pageview`
call sites. What is NOT established, because it needs a device and a project
key: that the webview's persistence behaves as a browser's does in practice,
and that no native-shell navigation bypasses React Router. The `webDir: 'out'`
setting is a static-export fallback that `server.url` overrides at runtime; if
`server.url` were ever removed, the origin would become `capacitor://localhost`
and cookie persistence would silently fail — that is the failure mode to test
for first on a device.

⚠️ One asymmetry worth knowing: `server.url` is the APEX host, so a native
session starts on `theharvest.app`, not on a church's subdomain. Tenant-scoped
public pages (`nations.theharvest.app/form/…`) are reached in the native shell
only if the webview navigates to that host.

### 7. Vercel Analytics — keep both, for now

`@vercel/analytics/next` is imported at `src/app/layout.tsx:4` and rendered at
line 279. **This PR does not remove it**, and it should not be removed casually,
but the founder should decide.

They do not measure the same thing:

| | Vercel Analytics | PostHog (after THE-206) |
|---|---|---|
| Coverage | every Next route | every route except the pre-auth funnel |
| Unit | anonymous page views and Web Vitals | identified people and churches, plus anonymous public traffic |
| Question it answers | "is the site fast, and how much traffic?" | "which churches use the CRM, and how often?" |

⚠️ **THE-206 changed this row.** The overlap is now nearly total: PostHog counts
the public routes too. The counts will still disagree, but for one remaining
reason rather than two — PostHog does not count `/auth`, `/onboarding` or
`/church-onboarding`, deliberately. That is a difference in definition, not a
bug in either.

The recommendation is to keep both until PostHog has a month of data, then drop
Vercel Analytics if its Web Vitals are not being read — `capture_performance` is
`false` here precisely so the two are not both paying for the same metric.

Removing it would mean editing `layout.tsx`, which this PR deliberately does not
do.

## Consent

⚠️ Whether an analytics cookie needs consent from an EU church's members is a
legal question, not a technical one. This PR does not answer it and 🔴 does not
build a consent banner.

**What PostHog does by default**, so the question can be asked precisely:

- `persistence` defaults to `'localStorage+cookie'` — it writes a first-party
  cookie (`ph_<token>_posthog`, 365 days by default) *and* a `localStorage`
  entry, holding the distinct id, session id and initial-referrer properties.
- `person_profiles` is set to `'identified_only'` here, so an anonymous visitor
  gets no stored person profile — but the id cookie is still written.

**What a consent-gated setup would require**, in rough order of effort:

1. `opt_out_capturing_by_default: true`, then `posthog.opt_in_capturing()` when
   consent is given. Nothing is captured or persisted until then.
2. Or `persistence: 'memory'`, which keeps everything in the tab and writes no
   cookie or storage — at the cost that every reload is a new anonymous person,
   so returning-user and retention numbers become meaningless.
3. Or `cookieless_mode: 'on_reject'` (PostHog's own answer): cookies while
   consent stands, a server-side privacy-preserving hash when it does not. It
   must also be enabled in the PostHog project settings or the cookieless events
   are discarded.
4. A banner, a stored decision, and a way to withdraw it — none of which exists
   in this app today.

## The privacy policy gap

⚠️ **This section was written for THE-36 and its opening claim is now out of
date.** The policy HAS since been given an analytics disclosure — see
"THE-206 makes one sentence of it false" below, which is the live item.

🔴 **(THE-36, as written then) The published privacy policy makes no mention of
analytics.**

The canonical policies live on `theharvest.site` and the app links to them
(`src/lib/legal-links.ts` — deliberately, so there is one source and it is not
restated in-app). Neither `theharvest.site/privacy` nor anything in this repo
tells a member that a third-party analytics processor sees their usage.

This is the same class of gap as the AI-features one already on the board:
a processor that is in use and is not disclosed to the data subjects. Members
are the data subjects here — Harvest holds their name, email, attendance, giving
history and in some cases their children's check-in details — and
`legal-links.ts` already argues, in its own comment, that hiding processing from
the person it belongs to is "the wrong side of GDPR and the first thing a
reviewer looks for".

It needs a paragraph on the site naming PostHog, the region, what is collected
(a Firebase user id, a church, a screen name — no contact details, no giving,
no message content) and the retention period. That is a policy edit in a
different repo, not a code change here, which is why it is reported rather than
fixed.

### 🔴 THE-206 makes one sentence of it false

That paragraph was since written. It now lives in
`bumbmatei-sys/harvest-presentation-site`, at `src/content/legal.ts`, in the
section *"4. Where the data lives, and who else touches it"*. **Its last
sentence is made false by this PR, and the founder has already agreed to change
it.** Verbatim, so it can be found and corrected:

> What is sent instead is a short, fixed list: that a screen was opened, whether
> it was an admin or a member screen, the internal account id of the person
> signed in, and the church that account belongs to. No names, no email
> addresses, no giving, no message or prayer content. **Screens outside the
> signed-in application — this marketing site, sign-in and onboarding, and
> public blog, form and event pages — send nothing at all.**

Three corrections are needed, not one:

1. 🔴 **The bolded sentence is now false.** Public blog, form and event pages —
   and seven more like them — now send a pageview. Only the marketing site
   (a different application) and sign-in/onboarding still send nothing.
2. ⚠️ **"whether it was an admin or a member screen"** is now three values, not
   two: `admin`, `member` or `public`.
3. ⚠️ **"the internal account id of the person signed in"** no longer describes
   every event. A public-page visitor is not signed in; what is recorded is a
   random device id and **no stored person profile**. The policy's own earlier
   sentence — *"each event is recorded against the internal account id of the
   person signed in, and against the church their account belongs to"* (section
   3) — needs the same qualification.

The route pattern itself (`/form/[formId]`) is worth naming in the replacement
text as what is stored, since it is deliberately not the visited URL.

⚠️ `src/content/legal.test.ts` in that repo may pin this prose; expect it to
need updating alongside. The policy's `LEGAL_UPDATED` constant reads
`'2026-08-10'` and should move with the edit.

## What the founder must do

Nothing in this PR works until these are done, and nothing breaks while they are
not.

1. **Create the PostHog project.** app.posthog.com → new project.
   ⚠️ **Choose the region at creation — EU is the recommendation, and it cannot
   be migrated afterwards.**

2. **Copy the project API key** — the one that starts `phc_`, from *Project
   settings → Project API key*.
   🔴 **Not** a personal API key (`phx_`). That one is a secret with write access
   to the whole account and must never be committed or given a `NEXT_PUBLIC_`
   name.

3. **Set two environment variables in Vercel**, on Production, Preview and
   Development:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_POSTHOG_KEY` | the `phc_…` project key |
   | `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` (or the US host if the project is US) |

   ⚠️ **Do not tick Vercel's "Sensitive" toggle on either.** Sensitive values are
   write-only and are not exposed to the build, so a `NEXT_PUBLIC_*` variable
   marked sensitive is inlined as empty — the app then degrades to "no key"
   silently, which looks exactly like a working install with no traffic. These
   two are public by design; the project key ships in the client bundle in the
   same way the Sentry DSN already does.

4. **In PostHog project settings, turn these off** — belt and braces, since the
   client already refuses them:
   - *Session replay* → off (the client cannot start it, but leaving it on in
     the UI invites a future "why isn't replay working?" that gets fixed the
     wrong way).
   - *Autocapture* → off.
   - *Enable heatmaps* → off.
   - *Discard client IP data* → **on**. This one is only available server-side:
     posthog-js's `ip` option is deprecated and has no effect, so the project
     setting is the only way to stop IP addresses being stored.

5. **Add the analytics paragraph to `theharvest.site/privacy`** before the key
   goes into Production. See the gap above.

6. Optional, later: a reverse proxy (a Next rewrite from `/ingest` to the
   PostHog host) so ad-blockers do not drop events. Not done here — it would
   mean editing `next.config.mjs`, and it is not needed to answer any of the
   questions above.
