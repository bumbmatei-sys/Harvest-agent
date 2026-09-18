# Verification

Borrowed from grokbot-field-notes: proof beats assertion.

## Rule

A change is not done until there is evidence a skeptical reviewer can check without re-running the whole project.

## Matrix

| Kind | Minimum proof | Extra for risky work |
|---|---|---|
| UI | Screenshot or short clip of the real screen | Before/after pair |
| Bugfix | Repro failed, then same repro passed | Regression note |
| API / backend | Real response or log excerpt | Contract / status codes |
| Data / migration | Dry-run output + row counts | Rollback plan |
| Refactor | Existing flow still works (test or manual) | Diff size kept small |
| Config / env | Diff of intended values (redact secrets) | Who approved |

## Who checks

1. Builder (Grok Build CLI / PM - Dev) attaches proof to the PR or ClickUp task.
2. Reviewer - Dev refuses to approve without proof.
3. Executive escalates to M B when proof is missing on something that looks "done."

## Anti-patterns

- "Should work" / "looks fine"
- Tests green with no UI shot for a UI change
- Screenshot of code or Figma instead of the running app
- Proof from a different environment than claimed
