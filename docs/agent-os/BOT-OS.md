# Harvest — Bot OS

House rules for anyone (human or bot) working in this repository.  
Adapted from grokbot-field-notes patterns; owned by The Harvest (M B).

For bot-specific duties see ClickUp playbook / Bot Manager drafts.  
Deeper notes: `docs/agent-os/VERIFICATION.md`, `ORCHESTRATION.md`, `ANTIPATTERNS.md`.

> **Note:** Root `AGENTS.md` remains the coding-agent project context (money model, guards, silent-failure rule). This Bot OS doc is the team operating layer. Do not replace root AGENTS.md with this file.

## Product

The Harvest is a multi-tenant ministry SaaS (attendance, groups, giving, communications).  
Tenant data is sacred. Prefer the smallest change that solves the real problem.

## Who does what

| Role | Responsibility |
|---|---|
| M B (founder) | Approves merge, deploy, spend, publish, tenant-data risk |
| Executive | Routes work, brings decisions to M B, owns cross-team status |
| PM - Dev | Owns eng delivery; drives **Grok Build CLI**; ClickUp Board |
| Reviewer - Dev | Independent review; checks proof; never reviews own build |
| Grok Build CLI | Writes and runs the code on branches / PRs |

Agents draft and organize. They do not merge or deploy without explicit founder approval.

## Proof of done (required)

| Change | Proof |
|---|---|
| UI | Screenshot(s) or short recording of the real UI |
| Bug | Fail → fix → pass with same steps |
| Backend | Real command/API output or measurable before/after |
| Refactor | Proof behavior unchanged |

"Green CI" alone is not enough for UI work.

## Human gates

Never automate without M B:

- Merge to `main`
- Production deploy / secrets / env
- Payments, refunds, pricing
- Outbound customer/church email or social
- Destructive Firestore or tenant mutations
- Auth / security rule changes

## Coding standards

- Prefer clarity over cleverness.
- Multi-tenant: never leak data across churches; scope every query by tenant.
- Trust-bearing logic stays on the server; client is untrusted.
- No new dependencies without a one-line why in the PR.
- Match existing patterns in the folder you touch.
- Keep PRs small and reviewable.

## Autopilot

Default = **draft**: implement on a branch, open PR, wait for M B.  
Autopilot merge / deploy are off unless M B enables a specific lane in writing.

## Communication

- Only Executive, Bot Manager, and Inbox Triage message M B directly.
- Other agents report to Executive.
- If there is nothing important to say, say nothing.

## When you are wrong

Fix the work, write the principle into this file or `docs/agent-os/`, delete the incident story from permanent rules.
