# Antipatterns (Harvest filter)

Principles only. Full incident catalog lives in grokbot-field-notes; we keep the lessons that apply here.

## Org / bots

1. **Too many bots** — if a skill or routine on an existing bot works, do not create a new agent.
2. **Copy-paste constitutions** — one SHARED-STANDARDS / Bot OS; bots get thin role prompts.
3. **Unstated norms** — write the rule or it does not exist.
4. **Rules that remember the war** — store the principle, delete the anecdote from permanent text.
5. **Every bot talks to the founder** — only Executive, Bot Manager, Inbox Triage.
6. **Group chat dogpile** — not every bot replies to every message.
7. **Saying urgent instead of defining P0** — severity needs a written policy before it means anything.
8. **Yes-bots** — specialists should push back with cost, risk, and alternatives.

## Delivery

9. **No proof** — screenshots for UI; fail→pass for bugs.
10. **Builder reviews self** — Reviewer - Dev is independent.
11. **Autopilot on money or prod** — human gate.
12. **High-frequency noise** — prefer event triggers or ≤2 digests/day.
13. **Trust on the client** — authz and tenant scoping on the server.
14. **Giant PRs** — small, reviewable diffs.
15. **Silent scope creep** — re-scope with Executive before expanding the task.

## When tempted

Ask: "Would M B want a new bot, or a clearer instruction on an existing one?"  
Default to the latter.
