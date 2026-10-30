'use client';
import { useState } from 'react';
import { QrCodeDialog } from '@/components/form-follow-up/QrCodeDialog';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export function ShareCard({ handle }: { handle: string }) {
  const url = `https://theharvest.app/s/${handle}`;
  const [status, setStatus] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(url); setStatus('Link copied.'); } catch { setStatus('Could not copy link.'); } }
  return <Card><CardHeader><CardTitle>Share page</CardTitle></CardHeader><CardContent className="space-y-4"><p className="break-all">{url}</p><div className="flex flex-wrap gap-2"><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy link</Button><QrCodeDialog url={url} name={handle} /></div>{status && <p role="status" className="text-sm">{status}</p>}</CardContent></Card>;
}
