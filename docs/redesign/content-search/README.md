# Palette content search: proof

Screenshots of the real admin palette (Ctrl K), taken in a real browser against the real
app and the Firestore and Auth **emulators**, with `firestore.rules` loaded, so the rules
decide what each user can read. Nothing here touches the live project.

The tenant is fictional ("Grace Fellowship") and has a second tenant ("Rival Chapel") whose
documents share names with it, to show they never appear.

| File | What it shows |
| --- | --- |
| `00-loading-state.png` | Firestore held back for a few seconds: the palette says it is loading, and pages still work |
| `01-search-a-name.png` | Searching a person ("ionescu"); only the current tenant's Maria Ionescu, not the other tenant's |
| `02-search-a-note-title.png` | A note, found by title |
| `03-search-a-course.png` | A course and its lessons |
| `04-accent-insensitive.png` | "stefan" finds both "Ștefan" and "Stefan" |
| `05-grouped-results-and-see-all.png` | Grouped results, five rows at most per group, "See all 6 people" |
| `06-staff-role-sees-only-its-tabs.png` | A staff admin with only Events and Forms: "sermon" finds nothing |
| `06b-staff-role-events-forms.png` | The same staff admin searching "e": pages, events and forms only |
| `07-no-results.png` | Empty state |
| `08-empty-box-pages.png` | Empty box: the sections, grouped as before |
| `09-enter-opens-the-note.png` | Enter on the note opened it in Notes |

## How they were made

1. `firebase emulators:start --only firestore,auth` with this repo's `firestore.rules`.
2. `seed-emulator.mjs` fills the emulators (Admin SDK, emulator hosts only).
3. A throwaway local patch to `src/firebase.ts` (not committed) pointed the SDK at the
   emulators and signed the demo user in; `next dev` served the app.
4. `capture.mjs` drove Chromium with Playwright. Paths inside it are from the machine it ran on.
