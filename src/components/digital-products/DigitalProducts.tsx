'use client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ProductWizard } from '@/components/product-wizard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { authFetch } from '@/utils/auth-fetch';
import { MAX_PDF_UPLOAD_BYTES } from '@/utils/upload-limits';
import { PAID_PRODUCT_CHECKOUT_ENABLED } from '@/utils/plan-features';

type Product = {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  priceCents: number;
  status: 'draft' | 'published';
  objectKey?: string;
  fileName?: string;
  fileSize?: number;
  entitled?: boolean;
};
export const DigitalFetchContext = createContext(authFetch);
async function api(request: typeof authFetch, path: string, body?: unknown) {
  const response = await request(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export function validateDigitalPdf(file: File): string | null {
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) return 'Choose a PDF file.';
  if (file.size <= 0 || file.size > MAX_PDF_UPLOAD_BYTES) return 'PDF must be at most 15MB.';
  return null;
}
function priceLabel(product: Product) {
  return product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'Free';
}
function useProducts(admin: boolean) {
  const request = useContext(DigitalFetchContext);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setError('');
      setProducts((await api(request, `/api/digital-products${admin ? '?admin=1' : ''}`)).products);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load products');
    }
  }, [admin, request]);
  useEffect(() => { void load(); }, [load]);
  return { products, setProducts, error };
}
export function DigitalAdminList({ onEdit }: { onEdit: (product: Product) => void }) {
  const { products, error } = useProducts(true);
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">Digital downloads</h2>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!products && !error && <p>Loading downloads…</p>}
      {products?.map(product => (
        <Card key={product.id}>
          <CardContent className="flex items-center gap-4">
            {product.coverUrl && <img src={product.coverUrl} alt="" className="h-16 w-16 rounded-brand object-cover" />}
            <div className="flex-1">
              <p className="font-semibold">{product.title}</p>
              <Badge variant="secondary">{product.status === 'draft' ? 'Draft' : 'Published'}</Badge>
              <span className="ml-2">{priceLabel(product)}</span>
            </div>
            <Button variant="outline" className="min-h-11" onClick={() => onEdit(product)}>Edit</Button>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
export function DigitalEditor({ initial, onClose }: { initial?: Product | null; onClose: () => void }) {
  const request = useContext(DigitalFetchContext);
  const [product, setProduct] = useState<Product>(() => initial || { id: crypto.randomUUID(), title: '', description: '', coverUrl: '', priceCents: 0, status: 'draft' });
  const [price, setPrice] = useState(() => initial ? (initial.priceCents / 100).toFixed(2) : '0');
  const pdfInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState('details');
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  function change(patch: Partial<Product>) {
    setSaved(false);
    setProduct(p => ({ ...p, ...patch }));
  }
  async function upload(file: File, cover = false) {
    const invalid = cover ? (!file.type.startsWith('image/') ? 'Choose an image.' : '') : validateDigitalPdf(file);
    const setUploadError = cover ? setError : setPdfError;
    if (invalid) { setUploadError(invalid); return; }
    setBusy(true);
    setUploadError('');
    try {
      const result = await api(request, cover ? '/api/storage/presign' : '/api/digital-products/upload', cover
        ? { fileName: file.name, contentType: file.type, fileSize: file.size }
        : { productId: product.id, contentType: file.type, fileSize: file.size });
      const response = await fetch(result.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Upload failed');
      change(cover ? { coverUrl: result.publicUrl } : { objectKey: result.key, fileName: file.name, fileSize: file.size });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  }
  const validPrice = /^\d+(?:\.\d{1,2})?$/.test(price) && Number.isSafeInteger(Math.round(Number(price) * 100));
  const blocked = !product.title.trim() ? 'Add a title.' : !product.objectKey ? 'Upload a PDF.' : !validPrice ? 'Enter a valid price.' : null;
  async function save(status: 'draft' | 'published') {
    if (blocked) { setError(blocked); return; }
    setBusy(true);
    setError('');
    try {
      await api(request, '/api/digital-products', { ...product, priceCents: Math.round(Number(price) * 100), status });
      setProduct(p => ({ ...p, status, priceCents: Math.round(Number(price) * 100) }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant="ghost" className="min-h-11" onClick={onClose}>Back to products</Button>
      <ProductWizard productLabel="Digital download" title={product.title} untitledLabel="Untitled download" status={product.status}
        steps={[{ id: 'details', label: 'Details', done: !!product.title.trim() }, { id: 'file', label: 'PDF', done: !!product.objectKey }, { id: 'price', label: 'Price and publish', done: validPrice }]}
        activeStepId={step} onStepChange={setStep} saving={busy} error={error} saved={saved}
        onSaveDraft={() => void save('draft')} onPublish={() => void save('published')} publishBlockedReason={blocked}>
        {step === 'details' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="digital-title">Title</Label>
              <Input id="digital-title" value={product.title} onChange={e => change({ title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="digital-description">Description</Label>
              <Textarea id="digital-description" value={product.description} onChange={e => change({ description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="digital-cover">Cover image</Label>
              <Input id="digital-cover" type="file" accept="image/*" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, true); }} />
              {product.coverUrl && <img src={product.coverUrl} alt="Cover preview" className="mt-2 max-h-40" />}
            </div>
          </div>
        )}
        {step === 'file' && (
          <div className="space-y-3">
            <Label htmlFor="digital-pdf">PDF (up to 15MB)</Label>
            <div
              className="rounded-brand-lg border border-dashed border-line p-6"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file && !busy) void upload(file);
              }}
            >
              {product.objectKey ? (
                <>
                  <p>{product.fileName || 'PDF uploaded'}{product.fileSize ? ` · ${(product.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="min-h-11" aria-label="Replace PDF" disabled={busy} onClick={() => pdfInput.current?.click()}>Replace</Button>
                    <Button type="button" variant="outline" className="min-h-11" aria-label="Remove PDF" disabled={busy} onClick={() => { change({ objectKey: undefined, fileName: undefined, fileSize: undefined }); setPdfError(''); }}>Remove</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">Drop a PDF here or choose a file.</p>
                  <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={() => pdfInput.current?.click()}>Choose a PDF</Button>
                </>
              )}
              <input ref={pdfInput} className="sr-only" id="digital-pdf" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} />
            </div>
            {pdfError && (
              <Alert variant="destructive">
                <AlertDescription>{pdfError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        {step === 'price' && (
          <div className="space-y-3">
            <Label htmlFor="digital-price">Price in USD (0 for free)</Label>
            <Input id="digital-price" inputMode="decimal" value={price} onChange={e => { setPrice(e.target.value); setSaved(false); }} />
            {Number(price) > 0 && !PAID_PRODUCT_CHECKOUT_ENABLED && <p className="text-sm text-muted">Paid checkout coming soon. Your price is saved, and members will see Coming soon.</p>}
          </div>
        )}
      </ProductWizard>
    </>
  );
}
export function DigitalMemberProducts() {
  const request = useContext(DigitalFetchContext);
  const { products, setProducts, error } = useProducts(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  async function act(product: Product) {
    setBusy(product.id);
    setActionError('');
    try {
      if (product.entitled) {
        const result = await api(request, '/api/digital-products/download', { productId: product.id });
        window.location.assign(result.url);
      } else {
        await api(request, '/api/digital-products/claim', { productId: product.id });
        setProducts(current => current?.map(p => p.id === product.id ? { ...p, entitled: true } : p) ?? null);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally { setBusy(null); }
  }
  return (
    <section className="space-y-4 p-4">
      <h1 className="font-display text-2xl">Digital products</h1>
      {(error || actionError) && (
        <Alert variant="destructive">
          <AlertDescription>{error || actionError}</AlertDescription>
        </Alert>
      )}
      {!products && !error && <p>Loading products…</p>}
      {products?.length === 0 && (
        <Card>
          <CardContent>No digital products yet.</CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products?.map(product => (
          <Card key={product.id}>
            {product.coverUrl && <img src={product.coverUrl} alt="" className="h-48 w-full object-cover" />}
            <CardContent className="space-y-3">
              <h2 className="font-display text-xl">{product.title}</h2>
              <p className="whitespace-pre-wrap">{product.description}</p>
              <Badge variant="secondary">{product.priceCents > 0 && !product.entitled ? 'Coming soon' : priceLabel(product)}</Badge>
              {(product.entitled || product.priceCents === 0) && (
                <Button className="min-h-11 w-full" disabled={busy === product.id} onClick={() => void act(product)}>
                  {product.entitled ? 'Download' : 'Get it free'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
