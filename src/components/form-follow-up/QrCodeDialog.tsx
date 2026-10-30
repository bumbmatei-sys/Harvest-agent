'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
function download(href: string, name: string) {
  const link = document.createElement('a'); link.href = href; link.download = name; link.click();
}
export function QrCodeDialog({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<{ png: string; svg: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true; setCodes(null); setError('');
    Promise.all([QRCode.toDataURL(url, { width: 1024, margin: 4 }), QRCode.toString(url, { type: 'svg', margin: 4 })])
      .then(([png, svg]) => { if (current) setCodes({ png, svg }); })
      .catch(() => { if (current) setError('Could not generate the QR code. Please retry.'); });
    return () => { current = false; };
  }, [open, url, attempt]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger data-form-qr-action render={<Button variant="outline" className="min-h-11" />}><QrCode className="size-4" />QR code</DialogTrigger>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>QR code</DialogTitle><DialogDescription>Scan to open {name}.</DialogDescription></DialogHeader>
      <p className="break-all text-sm text-muted">{url}</p>
      {!codes && !error && <p role="status">Generating QR code…</p>}
      {error && <div role="alert"><p>{error}</p><Button className="min-h-11" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
      {codes && <><img src={codes.png} alt={`QR code for ${name}`} className="mx-auto aspect-square w-full max-w-64" /><div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" onClick={() => download(codes.png, `${name}-qr.png`)}>Download PNG</Button><Button className="min-h-11" variant="outline" onClick={() => { const url = URL.createObjectURL(new Blob([codes.svg], { type: 'image/svg+xml' })); download(url, `${name}-qr.svg`); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download SVG</Button></div></>}
      <DialogClose render={<Button variant="outline" className="min-h-11" />}>Close</DialogClose>
    </DialogContent>
  </Dialog>;
}
