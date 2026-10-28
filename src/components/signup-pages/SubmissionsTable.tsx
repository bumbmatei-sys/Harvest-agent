'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SIGNUP_FIELDS, type SignupField } from '@/lib/signup-pages/model';
import { authFetch } from '@/utils/auth-fetch';
import { fieldLabels } from './SignupPageBuilder';
type Submission = { id: string; createdAt: string; answers: Partial<Record<SignupField, string>> };
export function SubmissionsTable({ pageId }: { pageId: string }) {
  const [rows, setRows] = useState<Submission[] | null>(null); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  useEffect(() => { let current = true; setRows(null); setError(''); authFetch(`/api/signup-pages/${encodeURIComponent(pageId)}/submissions`).then(async r => { if (!r.ok) throw new Error('Could not load submissions.'); const data = await r.json(); if (!Array.isArray(data.submissions)) throw new Error('Invalid submissions response.'); if (current) setRows(data.submissions); }).catch(() => { if (current) setError('Could not load submissions.'); }); return () => { current = false; }; }, [pageId]);
  async function download() { setExporting(true); setError(''); try { const r = await authFetch(`/api/signup-pages/${encodeURIComponent(pageId)}/export`); if (!r.ok) throw new Error(); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'signups.csv'; a.click(); URL.revokeObjectURL(url); } catch { setError('Could not export submissions.'); } finally { setExporting(false); } }
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Submissions</h2><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={download} disabled={exporting}><Download className="mr-2 h-4 w-4" />Export CSV</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}{!rows && !error && <p>Loading submissions…</p>}{rows && (rows.length === 0 ? <p className="text-muted-foreground">No submissions yet.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Submitted</TableHead>{SIGNUP_FIELDS.map(f => <TableHead key={f}>{fieldLabels[f]}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>{SIGNUP_FIELDS.map(f => <TableCell key={f}>{row.answers[f] || '—'}</TableCell>)}</TableRow>)}</TableBody></Table></div>)}</div>;
}
