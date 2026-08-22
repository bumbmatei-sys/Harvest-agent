#!/bin/bash
# THE-201 vitest measurement. Usage: bash .the201-test.sh <outfile>
cd /home/ubuntu/harvest-os/work-the201
OUT="$1"
npm test --silent > "$OUT" 2>&1
echo "npm test exit=$?"
grep -E "Test Files|Tests |Duration" "$OUT" | tail -10
