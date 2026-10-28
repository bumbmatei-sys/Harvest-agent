'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function MemberPostComposer({ value, onChange, onSubmit, posting, editing, onCancel }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void; posting: boolean; editing: boolean; onCancel: () => void;
}) {
  return <div className="space-y-3 rounded-2xl border border-line bg-surface-raised p-4">
    <Textarea aria-label="Share an update" placeholder="Share an update with the community…" maxLength={500} value={value} onChange={e => onChange(e.target.value)} />
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted" aria-live="polite">{value.length} / 500</span>
      <div className="flex gap-2">{editing && <Button className="min-h-11 sm:min-h-0" variant="outline" onClick={onCancel}>Cancel</Button>}<Button className="min-h-11 sm:min-h-0" onClick={onSubmit} disabled={posting || !value.trim() || value.length > 500}>{posting ? 'Saving…' : editing ? 'Update' : 'Post'}</Button></div>
    </div>
  </div>;
}
