'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export function ShareCard({ handle }: { handle: string }) {
  const url = `https://theharvest.app/s/${handle}`;
  const [qr, setQr] = useState(''); const [status, setStatus] = useState('');
  useEffect(() => { let current = true; setQr(''); QRCode.toDataURL(url, { width: 512, margin: 2 }).then(data => { if (current) setQr(data); }).catch(() => { if (current) setStatus('Could not generate QR code.'); }); return () => { current = false; }; }, [url]);
  async function copy() { try { await navigator.clipboard.writeText(url); setStatus('Link copied.'); } catch { setStatus('Could not copy link.'); } }
  return <Card><CardHeader><CardTitle>Share page</CardTitle></CardHeader><CardContent className="space-y-4"><p className="break-all">{url}</p><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy link</Button>{qr && <div className="space-y-3"><img src={qr} alt="QR code for sign-up page" className="h-48 w-48" /><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={() => { const a = document.createElement('a'); a.href = qr; a.download = `${handle}-qr.png`; a.click(); }}><Download className="mr-2 h-4 w-4" />Download PNG</Button></div>}{status && <p role="status" className="text-sm">{status}</p>}</CardContent></Card>;
}
