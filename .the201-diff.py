#!/usr/bin/env python3
"""Diff vitest JSON runs by TEST ID, per test-baseline-verification.
A pass/fail COUNT is not evidence; only the failing SET is."""
import json, sys

def fails(path):
    with open(path) as f:
        data = json.load(f)
    out = set()
    for suite in data.get("testResults", []):
        fname = suite.get("name", "?")
        # A suite that dies at import/collection reports no assertions at all.
        if suite.get("status") == "failed" and not suite.get("assertionResults"):
            out.add(f"{fname} :: <SUITE-LEVEL FAILURE (collection/import)>")
        for a in suite.get("assertionResults", []):
            if a.get("status") == "failed":
                out.add(f"{fname} :: {a.get('fullName') or a.get('title')}")
    return out, data

base, bd = fails(sys.argv[1])
after, ad = fails(sys.argv[2])

def tot(d):
    return (d.get("numTotalTests"), d.get("numPassedTests"),
            d.get("numFailedTests"), d.get("numTotalTestSuites"))

print(f"BASELINE totals (total/passed/failed/suites): {tot(bd)}")
print(f"AFTER    totals (total/passed/failed/suites): {tot(ad)}")
print(f"\nbaseline failing tests: {len(base)}")
print(f"after    failing tests: {len(after)}")

new = sorted(after - base)
fixed = sorted(base - after)

print(f"\n===== NEW FAILURES (introduced by the change): {len(new)} =====")
for t in new:
    print("  NEW  " + t)
if not new:
    print("  (none)")

print(f"\n===== BASELINE FAILURES NOW PASSING: {len(fixed)} =====")
for t in fixed[:40]:
    print("  FIXED " + t)
if len(fixed) > 40:
    print(f"  ... and {len(fixed)-40} more")
if not fixed:
    print("  (none)")

print(f"\n===== STILL-RED BASELINE (pre-existing, not mine): {len(base & after)} =====")
files = {}
for t in sorted(base & after):
    files[t.split(" :: ")[0]] = files.get(t.split(" :: ")[0], 0) + 1
for f, n in sorted(files.items(), key=lambda x: -x[1]):
    print(f"  {n:4d}  {f}")

print("\nVERDICT: " + ("NO NEW FAILURES" if not new else f"{len(new)} NEW FAILURES — MINE TO FIX"))
