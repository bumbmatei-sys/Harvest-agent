'use client';

import { groupsForAllSides, tabsOpenedFrom, type ShellTabRef } from './shell-nav';

/**
 * The labels entitlement tests already scan for.
 *
 * The desktop sidebar mounts only at `lg`. Below that, and in happy-dom before
 * `matchMedia` reports a width, it is not in the tree — so the permitted tabs
 * are advertised here, on the same attributes the rail used to carry. Placeholder
 * rows are omitted: they are not tabs and must not look entitled.
 */
export function NavEntitlementCatalog({
  tabs,
  canSettings,
}: {
  tabs: ReadonlyMap<string, ShellTabRef>;
  canSettings: boolean;
}) {
  const groups = groupsForAllSides(tabs);
  return (
    <div data-nav-entitlement-catalog hidden>
      {groups.map((group) => {
        const live = group.items.filter((item) => item.placeholder === null);
        if (live.length === 0) return null;
        return (
          <div
            key={group.id}
            data-nav-group={group.id}
            data-nav-group-tabs={live.map((item) => item.id).join(',')}
            data-nav-group-labels={live.map((item) => item.entitlementLabel).join('|')}
          >
            {/* Tabs a row's page opens instead of a row of their own (Livestream, from Communities). */}
            {live.map((item) => {
              const opens = tabsOpenedFrom(item.id, tabs);
              return opens.length > 0 ? <div key={item.id} data-nav-opens={opens.join('|')} /> : null;
            })}
          </div>
        );
      })}
      <div
        data-nav-account-tabs={canSettings ? 'settings' : ''}
        data-nav-account-labels={canSettings ? 'Settings' : ''}
      />
    </div>
  );
}
