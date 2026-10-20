'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmailApiError, type EmailApi, type ImportRowInput, type ImportSummary } from '@/components/email/email-api';
import { ErrorNote, TAP, plural } from '@/components/email/kit';
import { readImportRows } from '@/components/email/import-rows';

export function ImportDialog({ open, onOpenChange, api, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Pick<EmailApi, 'importContacts'>;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRowInput[]>([]);
  const [columns, setColumns] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function reset(next: boolean) {
    if (!next) { setFileName(null); setRows([]); setColumns(null); setConsent(false); setError(null); setSummary(null); }
    onOpenChange(next);
  }

  async function onFile(file: File | undefined) {
    setError(null);
    setSummary(null);
    if (!file) return;
    const read = readImportRows(await file.text());
    if (!read.ok) { setRows([]); setFileName(null); setError(read.error); return; }
    setFileName(file.name);
    setRows(read.rows);
    setColumns([read.columns.email, read.columns.name, read.columns.tags].filter(Boolean).join(', '));
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.importContacts(rows, consent));
      onImported();
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'The import could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import your list</DialogTitle>
          <DialogDescription>Bring your list over from Mailchimp, Substack, or any CSV. People join your CRM and your email list together.</DialogDescription>
        </DialogHeader>
        {summary ? (
          <div className="flex flex-col gap-3 text-sm" role="status">
            <p className="font-medium text-strong">Done. {plural(summary.added + summary.merged, 'person', 'people')} can now get your emails.</p>
            <ul className="flex flex-col gap-1 text-muted">
              <li>{plural(summary.added, 'new CRM person was', 'new CRM people were')} added.</li>
              <li>{plural(summary.merged, 'existing CRM person was', 'existing CRM people were')} added to the list.</li>
              {summary.alreadySubscribed > 0 && <li>{plural(summary.alreadySubscribed, 'person was', 'people were')} already on the list.</li>}
              {summary.blocked > 0 && <li>{plural(summary.blocked, 'person', 'people')} had unsubscribed or bounced and {summary.blocked === 1 ? 'was' : 'were'} left alone.</li>}
              {summary.invalid > 0 && <li>{plural(summary.invalid, 'row', 'rows')} had no valid email and {summary.invalid === 1 ? 'was' : 'were'} skipped.</li>}
              {summary.repeatedInFile > 0 && <li>{plural(summary.repeatedInFile, 'repeat', 'repeats')} in the file {summary.repeatedInFile === 1 ? 'was' : 'were'} ignored.</li>}
            </ul>
            <DialogFooter><Button className={TAP} onClick={() => reset(false)}>Close</Button></DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-import-file">CSV file</Label>
              <Input id="email-import-file" type="file" accept=".csv,text/csv" className={TAP} onChange={(e) => void onFile(e.target.files?.[0])} />
              <p className="text-xs text-faint">Needs a column headed Email. Name, First name, Last name and Tags columns are used when present. Up to 5,000 people at a time.</p>
            </div>
            {fileName && (
              <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <FileText className="size-4 text-muted" aria-hidden />
                <span className="text-strong">{fileName}</span>
                <span className="ml-auto text-muted">{plural(rows.length, 'row', 'rows')} · {columns}</span>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Checkbox id="email-import-consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
              <Label htmlFor="email-import-consent" className="text-sm leading-snug font-normal text-strong">
                Only import people who agreed to hear from you. I confirm these people asked to get email from my ministry.
              </Label>
            </div>
            <p className="text-xs text-muted">Anyone who already unsubscribed or bounced stays unsubscribed, even if they are in the file.</p>
            {error && <ErrorNote>{error}</ErrorNote>}
            <DialogFooter>
              <Button variant="outline" className={TAP} onClick={() => reset(false)}>Cancel</Button>
              <Button className={TAP} disabled={busy || rows.length === 0 || !consent} onClick={() => void run()}>{busy ? 'Importing…' : 'Import'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
