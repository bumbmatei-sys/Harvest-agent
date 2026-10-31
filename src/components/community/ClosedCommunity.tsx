'use client';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

/** What members see once an admin deletes the ministry's default community. */
export function ClosedCommunity({ name, isAdmin, onManage, onDiscover }: {
  name: string;
  isAdmin: boolean;
  onManage: () => void;
  onDiscover: () => void;
}) {
  return <div className="flex h-dvh items-center justify-center bg-surface p-4" data-community-closed>
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{name} has closed its community</EmptyTitle>
        <EmptyDescription>{isAdmin
          ? 'You deleted this community. Restore it from the Communities page in your admin.'
          : 'There is nothing to see here right now. You can find other communities in Discover.'}</EmptyDescription>
      </EmptyHeader>
      {isAdmin
        ? <Button className="min-h-11 sm:min-h-0" onClick={onManage}>Open Communities</Button>
        : <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={onDiscover}>Discover communities</Button>}
    </Empty>
  </div>;
}
