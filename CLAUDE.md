# CLAUDE.md

**The project context for this repository lives in [`AGENTS.md`](./AGENTS.md). Read that
file before doing anything else.**

This file exists only because Claude Code looks for `CLAUDE.md` while every other agent
looks for `AGENTS.md`. It is a pointer, not a second copy.

## Do not put project knowledge here

Two files describing one project is how a claim outruns the feature it describes — the
defect this repo has already corrected six times on the marketing site. `AGENTS.md` is the
single canonical context file. Anything you would be tempted to add here belongs there
instead, and `THE-371.docs-guards.test.ts` fails if this file starts accumulating its own
version of the facts.

A symlink would have avoided the question entirely, and was rejected: Git on Windows
materialises a symlink as a plain text file containing the target's path unless
`core.symlinks` is enabled, which needs Developer Mode or an elevated shell. A Windows
checkout would then hand an agent a nine-byte file as the whole of its project context,
and this repo's history with Windows — the CRLF digest breakage `.gitattributes` documents,
and the `path.relative` backslash failures — says that risk is live rather than
theoretical. A pointer file survives every checkout on every platform.
