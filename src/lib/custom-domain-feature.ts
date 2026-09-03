/**
 * THE-280 — the master switch for custom domains, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE. Set `CUSTOM_DOMAIN_ENABLED` to `true` and every surface below comes
 * back exactly as it was. Nothing is deleted to hide it: no route file, no
 * component, no branch, no Firestore field and no plan-matrix cell.
 * `tenants/{id}.config.customDomain`, `.customDomainStatus`,
 * `.customDomainVerified` and the `domains/{domain}` lookup row keep their
 * values, and `customDomain` keeps its column in `PLAN_FEATURES` — the gate sits
 * IN FRONT of all of them, so the tier that owns the capability still owns it
 * and gets it back whole.
 *
 * ⚠️ WHY IT IS ITS OWN FILE, and why it imports nothing. The same idiom as
 * `lib/sms-feature.ts` (THE-245) and `lib/stripe-connect-feature.ts` (THE-256),
 * for the same two reasons: the three older master switches live in
 * `utils/plan-features.ts`, which drags the entire pricing matrix into any module
 * that imports it; and this flag is read from BOTH a route handler and the client
 * bundle — `components/settings/DomainSection.tsx` ships it to the browser. THIS
 * FILE IMPORTS NOTHING and must not start to, so the gate stays cheap on the
 * server and free in the bundle.
 *
 * ─── Why it is off ───────────────────────────────────────────────────────────
 *
 * 🔴 THE FEATURE HAS NEVER BEEN TESTED, because the Vercel subscription that
 * would activate it was never bought. `/api/domains/provision` calls the Vercel
 * project-domains API with `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID`; on this
 * deployment those are unset, so the route answers 501 and the UI silently falls
 * back to writing `config.customDomain` and a `domains/{domain}` row directly.
 * That fallback attaches NOTHING at the edge: the DNS the church is then told to
 * add points at a domain no Vercel project serves, so verification never
 * completes and the address never resolves. The platform was offering churches
 * something that cannot work.
 *
 * ⚠️ THE GATE IS SERVER-SIDE FIRST and the UI follows it, exactly as THE-245 and
 * THE-256 argued. Hiding the panel alone would leave the write path live to any
 * authenticated tenant admin on an entitled plan calling the route directly.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503 while off; neither deletes anything):
 *   · `POST /api/domains/provision` — the write path. The Vercel attach plus the
 *     `tenants/{id}.config.customDomain` + `domains/{domain}` writes.
 *   · `GET /api/domains/provision` — "Check Status". Gated too, and not merely
 *     for symmetry: it is separately reachable AND it WRITES, mirroring
 *     `customDomainVerified` / `customDomainStatus` onto the tenant doc.
 *
 * Client:
 *   · `components/settings/DomainSection.tsx` — the custom-domain half only. It
 *     shows `CUSTOM_DOMAIN_HIDDEN_MESSAGE` in place of the address field, the
 *     DNS instructions, Save Domain and Check Status.
 *
 * ⚠️ TWO SCREENS MOUNT THAT COMPONENT — `AdminBranding` and `FirstRunSetup` —
 * so gating it once gates both, and neither grows a gate of its own.
 *
 * ─── 🔴 What it deliberately does NOT turn off: the SUBDOMAIN path ───────────
 *
 * EVERY TENANT IS SERVED ON `*.theharvest.app`, and that is a different
 * mechanism from a custom domain. None of it is gated, and breaking it would
 * take the whole platform down:
 *   · `lib/tenant-subdomain.ts`, `utils/non-tenant-subdomains.ts` — naming and
 *     resolving a tenant slug. Neither mentions a custom domain at all.
 *   · The subdomain half of `DomainSection` — the read-only `{tenantId}
 *     .theharvest.app` field, which is the address every church actually uses.
 *   · The subdomain claimed at signup (`ChurchOnboarding`, `FirstRunSetup`,
 *     `/api/tenants/provision-free`, `/api/tenants/finish-setup`). NO ONBOARDING
 *     FLOW ASKS FOR A CUSTOM DOMAIN — see the note below.
 *
 * 🔴 AND IT DOES NOT TURN OFF RESOLUTION, which is what keeps a church that
 * ALREADY set a domain working:
 *   · `lib/server-tenant.ts` — its custom-domain fallback still resolves a host
 *     to a tenant. This is the READ path; gating it would black out a live site.
 *   · `app/api/resolve-domain/route.ts` — the same, via the Firestore REST
 *     lookup. (⚠️ Its docblock says middleware calls it; `src/middleware.ts`
 *     only rate-limits and has not called it for some time. Left exactly as
 *     found — correcting stale prose is not this ticket's to do.)
 *
 * So the boundary is: the WRITE path and the OFFER are hidden; the READ path and
 * the whole subdomain path are untouched. A domain already provisioned and
 * verified keeps resolving, because nothing that serves it was gated.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * NO COLLECTION IS READ, WRITTEN OR MIGRATED BY THIS SWITCH. The gated route
 * refuses BEFORE it authenticates and before it opens Firestore, and while the
 * switch is off `DomainSection` never opens the tenant document at all — so
 * `config.customDomain`, `config.customDomainStatus`,
 * `config.customDomainVerified` and every `domains/{domain}` row are left exactly
 * as they are. Nothing migrates, nothing is cleared, and no church's domain is
 * forgotten. A church that already set one finds it where it left it when the
 * switch goes back on.
 */
export const CUSTOM_DOMAIN_ENABLED = false;

/**
 * What the gated route and the domain panel answer with while the switch is off.
 *
 * 503 rather than 404: the route EXISTS and is coming back, which is what a
 * stale admin tab should be told.
 *
 * Exported as a named const so a route and a component cannot word it
 * differently — the same reason `SMS_HIDDEN_MESSAGE` and
 * `STRIPE_CONNECT_HIDDEN_MESSAGE` are ones.
 */
export const CUSTOM_DOMAIN_HIDDEN_MESSAGE = 'Custom domains are temporarily unavailable.';
