'use client';

import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin-shell/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The social scheduler is included with one tier and is an add-on on every
 * other (see `PLAN_FEATURES.socialScheduler`). This wall only appears once the server has said this ministry
 * holds neither, so it does not name a plan: the add-on has no product yet, and
 * naming a tier would promise a purchase path that does not exist.
 */
export function SocialUpgradeWall({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 p-4 lg:p-0" data-testid="social-upgrade-wall">
      <PageHeader title="Social" subtitle="Schedule posts for the accounts this ministry connects." />
      <Card>
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted">
            <Lock className="size-5" aria-hidden />
          </div>
          <CardTitle className="font-display text-2xl font-semibold">Social scheduling is an add-on</CardTitle>
          <CardDescription>
            This ministry&apos;s plan does not include it. A ministry on a plan that includes it, or one that holds the add-on, can connect accounts and schedule posts from here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" className="min-h-11 sm:min-h-[38px]" onClick={onUpgrade}>
            View plans
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
