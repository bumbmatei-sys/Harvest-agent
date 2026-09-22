# Orchestration

How Harvest bots hand work around without drowning M B.

## Topology

```
M B
 ├── Executive          (only eng/ops conversation partner)
 ├── Bot Manager        (bot create / tighten only)
 └── Inbox Triage      (email only)
        │
        └── (via Executive)
              ├── PM - Dev ──► Grok Build CLI ──► PRs
              └── Reviewer - Dev ──► review + proof gate
```

## Lanes

| Lane | Owner | Trigger | Output |
|---|---|---|---|
| Intake | Executive | Founder ask / ClickUp / relay | Scoped task or decision request |
| Build | PM - Dev | Task on Board | Branch + PR via Grok Build CLI |
| Review | Reviewer - Dev | PR ready | Approve / request changes + proof check |
| Ship | M B | Approved PR | Merge / deploy |

## Autopilot ladder

1. **Investigate** — diagnose only.
2. **Draft** — default; PR waits.
3. **Autopilot merge** — off unless M B enables.
4. **Full autopilot** — off.

## Quiet rule

Routines and watchers that find nothing important send **no message**.

## Group chat (Harvest Dev)

- Executive posts briefs and decisions.
- PM - Dev and Reviewer - Dev speak when asked or when they own the thread.
- Bot Manager stays quiet except when adding members or changing bot config.
- No all-hands pile-on on every message.

## ClickUp

Space Harvest → folder Harvest → list Board.  
Task status is the source of truth for eng work; chat is for decisions and blockers.
