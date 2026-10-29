Form follow-up cards and QR sharing

The Sign-up page and regular Form editors now offer “After submit, show”: None, the tenant’s public community, or one of its published course/digital products. References are validated on server saves. Missing, private, unpublished and cross-tenant targets are rejected. After submission the public state rechecks visibility and renders the same DiscoverCard used by Discover, with Join or View. Join opens the existing public community page.

Digital downloads previously had no public landing page. `/products/[id]` now exposes published title, description and cover metadata on the matching tenant host. File keys and entitlements stay private; the landing page leads into the existing ministry app.

The shared shadcn QR dialog is available from Sign-up page lists and sharing details, plus Form lists and saved editors. It generates PNG and SVG with the existing qrcode dependency. Free members reach it directly through their Sign-ups tab. New controls carry a 44px minimum; the layout test targets 390px and suppresses transitions.

Stored references are `followUp: null`, `{ type: 'community', id }`, `{ type: 'product', id }` for courses, or `{ type: 'product', id, productKind: 'digital' }` for downloads. The explicit digital discriminator prevents collisions between course and download document IDs. Existing documents without followUp continue to mean None.

The new product page uses PublicRouteAnalytics and an explicit route inventory entry; analytics carries `/products/[id]`, never the live product ID.

Regular Form metadata now saves through `/api/forms/save` so the title, fields and follow-up save together after permission and reference validation. Activation and deletion retain the existing permission checks. Existing option-editor tests observe the server request and keep their original field/answer assertions. The route inventory and exact per-view token inventory have explicit additions; original baselines and primitive files remain intact.

The only Firestore rules change is `tenants/{tenantId}/forms/{formId}`: client creates must omit followUp; client updates must leave followUp unchanged; deletes retain hasFormsPermission. Reads and submission rules are unchanged. The Admin SDK save route performs validated follow-up writes. Emulator tests cover forbidden create/change/removal, preserved ordinary edits, deletion and tenant/member isolation. These rules auto-deploy on merge, so a separate founder approval is required before merging/deploying them. No deployment was performed.

Verification:

- Related validation, editor, public-page, rendering, Free QR and ownership/guard checks: 21 suites / 2,563 tests passed in the final focused run, including the full analytics test folder.
- Typecheck passed, including a baseline taken before edits. Lint passed with warnings.
- Real qrcode generation produced both PNG and SVG. Removing the cross-tenant condition made two tests fail; removing the QR touch floor made its guard fail. Both mutations were restored.
- Full suite was run with Node 24 and two workers. The last full run completed with 616 suites passing and 71 failing (16,362 tests passing, 1,019 failing, 51 skipped, one todo, and one unhandled localhost listen EPERM). Three feature-related inventory/pin failures from that run were subsequently fixed and covered by the final green 21-suite run. Remaining browser and shell/history checks cannot execute in this sandbox; the full suite is not green.
- The 390px browser check could not start Chrome: the sandbox denies socket operations. Firestore emulator startup also fails with listen EPERM on its localhost ports. These checks are not green and were not skipped or weakened.
- No git writes, staging, commits, dependency changes or deployments were made. New files were exercised directly and recorded by digest without staging.

No ticket number was supplied. `THE-999998` is an explicitly temporary local ownership-register identifier, following the existing temporary-ID pattern. Rename that record and its references when the actual ticket is assigned; no external ticket has been created or claimed.

Detailed local logs: `/tmp/form-card-related-complete-final.log`, `/tmp/form-card-complete-related.log`, `/tmp/form-card-typecheck-final.log`, `/tmp/form-card-lint-final.log`, `/tmp/form-card-full-final.log`, `/tmp/form-card-rules.log`, `/tmp/form-card-mobile2.log`, `/tmp/form-card-mutation.log`, and `/tmp/form-card-floor-mutation.log`.
