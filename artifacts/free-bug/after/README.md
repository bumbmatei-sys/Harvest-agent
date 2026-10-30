The declined screen is rendered from the real CheckoutRecovery component with the compiled application stylesheet in declined.html. It contains no Firebase or Dodo calls.

A mobile screenshot could not be captured in this environment: both installed Chromium variants fail at startup with `sandbox_host_linux.cc:41: shutdown: Operation not permitted`. The requested `/workspace/grokpr/free-bug/after/` destination is also read-only. No screenshot has been fabricated.

The browser regression can be run where Chromium is available:

```sh
CHROME_PATH=/path/to/chrome npx vitest run src/components/__tests__/CheckoutRecovery.mobile.test.tsx
/path/to/chrome --headless --no-sandbox --window-size=390,844 --screenshot=declined.png file:///tmp/harvest-declined-mobile.html
```

New accounts on every plan stay on theharvest.app. TenantContext follows the signed-in user's users/{uid}.tenantId, ignores tenant cookies on the apex, and clears prior tenant state on account changes. Legacy tenant hosts remain supported and are not migrated. Returning to the apex from an existing subdomain can require signing in once because Firebase sessions are scoped to an origin.

No website builder entry point exists in this checkout. Existing claim validation/migration logic is retained only in the server-only website-subdomain-claim helper and tenant-subdomain utility. No onboarding route calls it. A future website publishing flow must support aliases for stable internal tenant IDs before exposing a claim step.

Payment recovery preserves the selected plan, billing term, ministry name and any legacy slug marker. Signup itself never reserves a slug, including when payment succeeds; failed payment therefore consumes no website address. The server reuses an unfinished same-plan checkout and refuses to create a second subscription while the previous one is active or unsettled.

No git writes, deployment, real payment, or live Firestore writes were performed. firestore.rules, storage.rules, dependency manifests and lockfiles are unchanged.

Validation: 46 focused suites / 1,024 tests passed; THE-322 ownership register / 1,585 checks passed; typecheck and lint exited 0 (lint retains existing repository warnings). Mutation runs failed as required with the 60-second deadline removed and with subscription ownership enforcement removed. Both source files were restored before final validation. The mobile layout suite is blocked at Chromium startup by the environment and has not been represented as passing.
