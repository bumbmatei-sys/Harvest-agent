import { DiscoverView, type Listing, type LoadState } from './DiscoveryViews';

export function PublicDiscover({ state }: { state: LoadState<Listing[]> }) {
  return <main className="min-h-screen bg-surface text-strong">
    <header className="border-b border-line bg-surface-raised px-4 py-4 sm:px-8">
      <a href="https://theharvest.app" className="font-display text-xl font-semibold">Harvest</a>
    </header>
    <DiscoverView state={state} showFooter />
  </main>;
}
