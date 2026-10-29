'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { authFetch } from '@/utils/auth-fetch';
import type { FollowUp } from '@/lib/form-follow-up/model';
type Option = FollowUp & { name: string };
const optionKey = (option: FollowUp) => `${option.type}:${option.productKind || 'course'}:${option.id}`;
export function FollowUpSetting({ value, onChange, tenantId, request = authFetch }: { value: FollowUp | null; onChange: (value: FollowUp | null) => void; tenantId?: string; request?: typeof authFetch }) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError(''); setOptions(null);
    try {
      const response = await request(`/api/form-follow-up/options${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.options)) throw new Error('Could not load follow-up choices.');
      setOptions(data.options);
    } catch { setError('Could not load follow-up choices. Please retry.'); }
  }, [tenantId, request]);
  useEffect(() => { void load(); }, [load]);
  const key = value ? optionKey(value) : 'none';
  const selected = options?.find(option => optionKey(option) === key);
  return <Card data-form-follow-up-setting><CardContent className="space-y-3 py-4">
    <Label htmlFor="form-follow-up">After submit, show</Label>
    <Select value={key} onValueChange={key => { if (key === 'none') onChange(null); else { const item = options?.find(option => optionKey(option) === key); if (item) onChange({ type: item.type, id: item.id, ...(item.productKind ? { productKind: item.productKind } : {}) }); } }}>
      <SelectTrigger id="form-follow-up" className="min-h-11 min-w-0 w-full"><SelectValue className="min-w-0 truncate">{selected ? `${selected.type === 'community' ? 'Community' : 'Product'}: ${selected.name}` : value ? 'Saved selection (unavailable)' : 'None'}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem className="min-h-11" value="none">None</SelectItem>{value && options && !selected && <SelectItem className="min-h-11" value={key} disabled>Saved selection (unavailable)</SelectItem>}{options?.map(option => <SelectItem className="min-h-11" key={optionKey(option)} value={optionKey(option)}>{option.type === 'community' ? 'Community' : 'Product'}: {option.name}</SelectItem>)}</SelectContent>
    </Select>
    {!options && !error && <p role="status" className="text-sm text-muted">Loading choices…</p>}
    {options?.length === 0 && <p className="text-sm text-muted">Publish a community or product in this ministry to offer it after submission.</p>}
    {error && <div role="alert"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void load()}>Retry choices</Button></div>}
  </CardContent></Card>;
}
