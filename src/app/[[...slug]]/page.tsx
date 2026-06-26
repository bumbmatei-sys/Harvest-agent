"use client";
import dynamic from 'next/dynamic';

// Single-page client app. This optional catch-all route serves the SPA shell for
// EVERY non-API path (/, /admin, /admin/crm, /admin/docs/:id, …) so that React
// Router (BrowserRouter) deep links survive a hard refresh — Next.js would
// otherwise 404 on paths that have no matching file in the app/ directory.
const App = dynamic(() => import('../../App'), { ssr: false });

export default function Page() {
  return <App />;
}
