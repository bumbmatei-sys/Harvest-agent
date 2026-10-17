'use client';

import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The social scheduler is an add-on on every tier, so this wall does not name
 * a plan. No tier's matrix cell is true, and naming one would tell a ministry
 * that upgrading the plan buys a thing the plan does not include.
 */
export function SocialUpgradeWall({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 p-4 lg:p-0" data-testid="social-upgrade-wall">
      <header>
        <h1 className="font-display text-4xl font-light tracking-tight text-strong">Social</h1>
        <p className="mt-2 text-sm text-faint">Schedule posts for the accounts this ministry connects.</p>
      </header>
      <Card>
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted">
            <Lock className="size-5" aria-hidden />
          </div>
          <CardTitle className="font-display text-2xl font-semibold">Social scheduling is an add-on</CardTitle>
          <CardDescription>
            It is not included with any plan. A ministry that holds the add-on can connect accounts and schedule posts from here.
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
