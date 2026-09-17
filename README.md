# Harvest

Harvest is a multi-tenant SaaS for ministries. Each tenant gets its own subdomain —
`<slug>.theharvest.app` — with an admin side for the staff and a mobile-first member app
for everyone else: discipleship courses, a news feed, events and check-in, a CRM, giving
records and community groups, gated by plan.

This repository is the app. The marketing site (`theharvest.site`) and its docs
(`docs.theharvest.site`) live in a separate repository, `harvest-presentation-site`.

## One thing to know before reading the code

**Harvest does not process payments for ministries.** A ministry collects giving through
its own PayPal, Revolut, Wise, Venmo, Cash App or Zelle links, and records what arrived.
Harvest stores the record and takes nothing. Harvest's own subscriptions bill through Dodo
Payments. Several features you will find in the tree — SMS, the newsletter, custom
domains, the Gmail and QuickBooks connections, in-app card giving — sit behind master
switches that are currently off; the code is intact but the feature is not served.
`AGENTS.md` lists every switch.

## Running it

Requires Node 24 (see `engines` in `package.json`).

```bash
npm ci
npm run dev        # http://localhost:3000
```

Environment variables are documented in `.env.example`.

## Checks

```bash
npm test           # Vitest, src/**
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run test:rules # Firestore rules, needs the emulator — NOT run by CI
```

CI (`.github/workflows/test.yml`) runs the first three on every pull request. It does
**not** run the rules tests, and `firestore.rules` auto-deploys to production on merge, so
run `npm run test:rules` yourself for any rules change.

`npm test` is a large suite. On a two-core runner, pass `--maxWorkers=2`: a higher worker
count has produced failures on this repo that do not reproduce at two.

## Where the agent context lives

**[`AGENTS.md`](./AGENTS.md)** is the canonical context file for both humans and coding
agents — the money model, the plan matrix and its source of truth, the hidden feature
switches, the guard conventions, and the standing constraints that are not obvious from
the code. [`CLAUDE.md`](./CLAUDE.md) is a pointer to it, because Claude Code looks for
that filename.

Read `AGENTS.md` before changing anything. It opens with the Silent-Failure Rule, which is
the rule the rest of the repository is built around.
