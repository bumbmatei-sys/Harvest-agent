#!/bin/bash
# THE-201 targeted tests. vitest 4.1.9 => --maxWorkers (NOT --poolOptions.*, which throws CACError).
cd /home/ubuntu/harvest-os/work-the201 || exit 1
echo "########## TARGETED TESTS (touched files only) ##########"
npx vitest run \
  src/lib/__tests__/member-capacity.test.ts \
  src/utils/__tests__/member-cap-copy.test.ts \
  src/app/api/auth/set-claims/__tests__/member-cap.test.ts \
  src/app/api/tenants/member-capacity/__tests__/route.test.ts \
  src/components/__tests__/AuthPage.signup-capped.test.tsx \
  --pool=threads --maxWorkers=2 --minWorkers=1 \
  2>&1 | tail -45
echo "TARGETED_EXIT=${PIPESTATUS[0]}"
echo "########## DONE ##########"
