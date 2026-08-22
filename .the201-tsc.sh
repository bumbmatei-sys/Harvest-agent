#!/bin/bash
# THE-201 tsc measurement. Usage: bash .the201-tsc.sh <outfile>
cd /home/ubuntu/harvest-os/work-the201
OUT="$1"
export NODE_OPTIONS="--max-old-space-size=8192"
npx tsc --noEmit -p tsconfig.json > "$OUT" 2>&1
echo "tsc exit=$?"
echo "ERRORCOUNT=$(grep -c 'error TS' "$OUT")"
tail -5 "$OUT"
