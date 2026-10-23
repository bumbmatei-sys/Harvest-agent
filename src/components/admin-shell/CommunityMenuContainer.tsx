'use client';

import { Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTenantCommunities } from '@/hooks/useTenantCommunities';

import { CommunityMenu } from './AdminContentBar';
import { ShellErrorBoundary } from './ShellErrorBoundary';

function Connected({ tenantId, onOpen, onCreate }: { tenantId: string | null | undefined; onOpen: (id: string) => void; onCreate: () => void }) {
  const communities = useTenantCommunities(tenantId);
  return <CommunityMenu items={communities.items} loaded={communities.loaded} error={communities.error} onOpen={onOpen} onCreate={onCreate} />;
}

/**
 * The top bar's Community menu with its own read of the tenant's communities.
 * If that read throws, the menu still opens and says so, and "Create new
 * community" keeps working.
 */
export function CommunityMenuContainer(props: { tenantId: string | null | undefined; onOpen: (id: string) => void; onCreate: () => void }) {
  return (
    <ShellErrorBoundary
      label="community menu"
      fallback={
        <Button type="button" variant="secondary" className="h-8 min-h-[44px] sm:min-h-0" onClick={props.onCreate} title="Communities could not be loaded">
          <Users />
          Community
        </Button>
      }
    >
      <Connected {...props} />
    </ShellErrorBoundary>
  );
}
