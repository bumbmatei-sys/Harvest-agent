# The Harvest — PRD index

This folder holds the Product Requirements Document for The Harvest (`theharvest.app`), a
multi-tenant ministry SaaS platform.

- **[PRD.md](./PRD.md)** — the full document. One section per feature area: goal, users/roles,
  user stories, functional requirements, Eden parity notes, plan availability, data model
  notes, edge cases, mobile view, acceptance criteria, and open questions per section.
- **[screenshots/](./screenshots/)** — one subfolder per feature area that has screenshots,
  named to match the PRD section (e.g. `05-communities/`). Each subfolder has a `_manifest.json`
  listing every image's source path and caption.

## How the screenshots were sourced

Per Matei's direction, every screenshot in this document comes from the **Eden reference
material only**:

- `/workspace/eden-archive/**` (357 images)
- `/workspace/eden-ref/**` (57 images)
- `/workspace/reference-shots/eden-*/**` (87 images — `eden-email-2026-10-20`,
  `eden-2026-10-17`, `eden-courses-2026-10-20`, `eden-notes-2026-10-20`)
- `/workspace/website-ref/eden-email-themes/**` (24 images, overlapping with the previous set's
  count by folder)

That's roughly 500 source images. Every one is labelled **"Eden reference (design we copy)"**
with its device (desktop/mobile — almost all of this material is desktop; the only mobile Eden
references in the whole set are the 3 under
[`16-ui-system/`](./screenshots/16-ui-system/_manifest.json)). Exact-duplicate files were
deduped (same bytes); every visually distinct screen was kept, compressed to WebP (quality 70,
max width 1400px), and copied — the originals were never modified or deleted. Total compressed
size: **~13 MB** across 492 images, well under the 150 MB budget.

The broader 1,784-entry inventory at `/workspace/prd/screens.json` (which also includes current
Harvest UI screenshots, marketing-site crops, and third-party references like Skool/Luma/Framer)
was **not** used for this pass — see Open Question #22 in the PRD for whether a follow-up pass
should pull current-Harvest-UI screenshots from that fuller inventory for the sections below
that have none.

## Appendix: sections with no screenshots

No Eden reference material exists for these sections, because they describe Harvest-specific
surfaces with no direct Eden analogue, or because the feature isn't built yet and has no Eden
equivalent captured in the restricted image set used for this document:

| Section | Why there's nothing to show |
|---|---|
| §2 Accounts & tenancy | Infrastructure/data-model topic; no UI surface of its own |
| §4 Onboarding | Eden has no equivalent "create your creator workspace" funnel in the reference set |
| §8 Events + Communities integration | Not built yet; Harvest-specific, no Eden analogue |
| §13 Website builder & public website (as its own surface) | Eden has no "church website" product — its visual reference is entirely borrowed from Eden's link-in-bio/storefront screens, which are shown under §11 instead |
| §17 Campaigns, giving, dashboard — giving/dashboard/team-roles sub-parts | Harvest-specific (Eden has no giving analogue); only the Affiliates sub-part has Eden reference images (hidden feature, shown for completeness) |
| §18 Architecture & future | Infrastructure topic; the 2 "Integrations" Eden images shown are unrelated to the Neon migration and included only for completeness |
| §19 Security, privacy & compliance | Policy/infrastructure topic; no UI surface of its own |
| §20 Non-functional requirements, analytics & roadmap | Cross-cutting topic; no single screen represents it |

Every other section (1, 3, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16) has at least one screenshot
subfolder.

## Status

Working draft. See [§21 Open questions for Matei](./PRD.md#21-open-questions-for-matei) in the
PRD for everything this document deliberately left for Matei to decide rather than invent.
