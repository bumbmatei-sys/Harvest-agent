import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import net from 'net';
import { lookup } from 'dns/promises';
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFImage } from 'pdf-lib';
import { Resend } from 'resend';
import { requireAuth } from '@/lib/api-auth';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { getPlanFeatures } from '@/utils/plan-features';
import { verifyCourseCompletion } from '@/utils/course.utils';
import type { Course, QuizAttempt } from '@/types/course.types';
import type { TenantPlan } from '@/types/tenant.types';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Issue a server-signed PDF Certificate of Completion for a course.
 *
 * POST body: { courseId: string }
 *
 * A certificate is a TRUST ARTIFACT — a learner must never be able to forge
 * "I completed this course." So this route:
 *   1. Identifies the learner ONLY from the verified Firebase token (never a
 *      client-supplied userId).
 *   2. INDEPENDENTLY recomputes completion from Firestore (the authed user's
 *      own users/{uid} doc + the course doc, both read with the Admin SDK) via
 *      the shared verifyCourseCompletion helper — it never trusts a client
 *      claim of completion. If issueCertificate !== true, or completion isn't
 *      genuinely met, it refuses with 403 and emits no PDF.
 *   3. Is idempotent: the cert record id is `${uid}_${courseId}`, so
 *      re-requesting returns the same certificate (same number, same issue
 *      date) instead of minting a new one.
 *
 * The PDF is stored in the PRIVATE receipts bucket and handed back as a
 * short-lived signed URL (certs are never publicly enumerable). Tenant
 * branding (logo, primary color, ministry name) is applied ONLY when the
 * course's tenant plan has customBranding; lower plans get a neutral,
 * unbranded Harvest certificate.
 */

const DEFAULT_ACCENT = { r: 0.788, g: 0.588, b: 0.227 }; // Wheat Gold #C9963A
const INK = rgb(0.176, 0.145, 0.098); // earth #2D2519
const MUTED = rgb(0.545, 0.451, 0.333); // warm brown #8B7355
const FAINT = rgb(0.659, 0.604, 0.529); // #A89A87

/** Parse a #rrggbb / #rgb hex into a normalized rgb, or null if malformed. */
function hexToRgb(hex: unknown): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Deterministic, stable certificate number from the identity pair. */
function certNumberFor(uid: string, courseId: string): string {
  return createHash('sha256').update(`${uid}_${courseId}`).digest('hex').slice(0, 12).toUpperCase();
}

/**
 * Make an arbitrary string safe for the StandardFonts (WinAnsi) encoder so a
 * learner name / course title never throws and 500s the whole request. Common
 * typographic punctuation is folded to ASCII; anything outside printable ASCII
 * or the WinAnsi-safe Latin-1 range degrades to '?' rather than crashing.
 */
function sanitizePdfText(input: unknown): string {
  return String(input ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .split('')
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 0x20 && c <= 0x7e) return ch; // printable ASCII
      if (c >= 0xa0 && c <= 0xff) return ch; // Latin-1 supplement (WinAnsi-safe)
      if (c === 0x0a || c === 0x09) return ' ';
      return '?';
    })
    .join('');
}

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** True for loopback / private / link-local / CGNAT / ULA addresses (SSRF-unsafe). */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;         // link-local (incl. cloud metadata 169.254.169.254)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80')) return true; // ULA / link-local
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // unrecognized → treat as unsafe
}

/**
 * SSRF guard for the tenant-admin-controlled logo URL: allow only http(s) to a
 * public host. IP literals are checked directly; hostnames are resolved and
 * rejected if ANY resolved address is internal, so a logo URL can't be pointed
 * at the cloud metadata endpoint or an internal service.
 */
async function isSafeRemoteUrl(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return false;
  }
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const results = await lookup(host, { all: true });
    return results.length > 0 && results.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

/**
 * Fetch a remote logo and embed it. Best-effort: any failure (unsafe/bad URL,
 * non-image, unsupported format like webp/svg, timeout, oversize) returns null
 * so the certificate still issues — just without the logo.
 */
async function tryEmbedLogo(pdf: PDFDocument, url: unknown): Promise<PDFImage | null> {
  if (typeof url !== 'string' || !(await isSafeRemoteUrl(url))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // redirect:'error' stops a public URL from bouncing to an internal one.
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') || 0) > MAX_LOGO_BYTES) return null; // declared-size precheck
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    // Magic bytes: PNG (89 50 4E 47) vs JPEG (FF D8).
    if (buf[0] === 0x89 && buf[1] === 0x50) return await pdf.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return await pdf.embedJpg(buf);
    // Unknown header — try PNG then JPG before giving up.
    try { return await pdf.embedPng(buf); } catch { /* fall through */ }
    try { return await pdf.embedJpg(buf); } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface CertData {
  learnerName: string;
  courseTitle: string;
  teacherName?: string;
  ministryName: string; // wordmark: tenant name (branded) or "Harvest" (neutral)
  branded: boolean;
  accent: { r: number; g: number; b: number };
  logo: unknown; // logo URL, only used when branded
  issuedAt: Date;
  certNumber: string;
}

/** Draw `text` horizontally centered on `page` at baseline `y` (WinAnsi-safe). */
function drawCentered(
  page: any, text: string, y: number, size: number, font: PDFFont, color: any, width: number,
): void {
  const safe = sanitizePdfText(text);
  const w = font.widthOfTextAtSize(safe, size);
  page.drawText(safe, { x: (width - w) / 2, y, size, font, color });
}

/**
 * Draw `text` horizontally centered with extra letter-spacing (tracking),
 * for refined all-caps eyebrow labels. WinAnsi-safe.
 */
function drawTrackedCentered(
  page: any, text: string, y: number, size: number, font: PDFFont, color: any, width: number, tracking: number,
): void {
  const chars = sanitizePdfText(text).split('');
  const widths = chars.map((ch) => font.widthOfTextAtSize(ch, size));
  const totalW = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let x = (width - totalW) / 2;
  for (let i = 0; i < chars.length; i++) {
    page.drawText(chars[i], { x, y, size, font, color });
    x += widths[i] + tracking;
  }
}

/** Draw a small outlined diamond flourish centered at (cx, cy). */
function drawDiamond(page: any, cx: number, cy: number, r: number, color: any): void {
  const pts = [
    { x: cx, y: cy + r }, { x: cx + r, y: cy }, { x: cx, y: cy - r }, { x: cx - r, y: cy },
  ];
  for (let i = 0; i < pts.length; i++) {
    page.drawLine({ start: pts[i], end: pts[(i + 1) % pts.length], thickness: 1.2, color });
  }
}

/**
 * Draw a right-angle corner ornament (an inward-pointing bracket) at each
 * corner of the rectangle described by (x0,y0)-(x1,y1).
 */
function drawCornerOrnaments(
  page: any, x0: number, y0: number, x1: number, y1: number, armLen: number, thickness: number, color: any,
): void {
  const corners = [
    { x: x0, y: y0, dx: 1, dy: 1 },
    { x: x1, y: y0, dx: -1, dy: 1 },
    { x: x0, y: y1, dx: 1, dy: -1 },
    { x: x1, y: y1, dx: -1, dy: -1 },
  ];
  for (const c of corners) {
    page.drawLine({ start: { x: c.x, y: c.y }, end: { x: c.x + c.dx * armLen, y: c.y }, thickness, color });
    page.drawLine({ start: { x: c.x, y: c.y }, end: { x: c.x, y: c.y + c.dy * armLen }, thickness, color });
  }
}

async function buildCertificatePdf(data: CertData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const W = 842, H = 595; // A4 landscape
  const page = pdf.addPage([W, H]);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const accent = rgb(data.accent.r, data.accent.g, data.accent.b);

  // Frame: a single understated hairline rule, with crisp accent-color corner
  // ornaments set slightly inside it — quieter and more crafted than the old
  // double rectangle.
  page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: FAINT, borderWidth: 0.75 });
  drawCornerOrnaments(page, 40, 40, W - 40, H - 40, 26, 1.5, accent);

  let y = H - 106;

  // Branded logo (best-effort, already null on any failure) centered at the top.
  if (data.branded && data.logo) {
    const img = await tryEmbedLogo(pdf, data.logo);
    if (img) {
      const maxW = 150, maxH = 56;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      page.drawImage(img, { x: (W - iw) / 2, y: y - ih + 12, width: iw, height: ih });
      y -= ih + 10;
    }
  }

  // Ministry wordmark (tenant name when branded, else neutral "Harvest").
  drawCentered(page, data.ministryName, y, 14, helvBold, accent, W);
  y -= 30;

  // Accent flourish + eyebrow (letter-spaced for a refined label feel).
  drawDiamond(page, W / 2, y + 4, 5, accent);
  y -= 24;
  drawTrackedCentered(page, 'CERTIFICATE OF COMPLETION', y, 11, helvBold, accent, W, 3.2);
  y -= 64;

  // Learner name — the hero of the composition: larger, with generous air
  // above and below.
  drawCentered(page, data.learnerName, y, 40, serif, INK, W);
  y -= 46;

  drawCentered(page, 'has successfully completed', y, 12, helv, MUTED, W);
  y -= 32;

  // Course title (bold), wrapped to two lines if very long.
  const titleSize = 20;
  const maxTitleW = W - 180;
  if (helvBold.widthOfTextAtSize(data.courseTitle, titleSize) > maxTitleW) {
    const words = data.courseTitle.split(' ');
    let line1 = '', line2 = '';
    for (const word of words) {
      const test = line1 ? `${line1} ${word}` : word;
      if (helvBold.widthOfTextAtSize(test, titleSize) <= maxTitleW || !line1) line1 = test;
      else line2 = line2 ? `${line2} ${word}` : word;
    }
    drawCentered(page, line1, y, titleSize, helvBold, INK, W);
    y -= 26;
    if (line2) { drawCentered(page, line2, y, titleSize, helvBold, INK, W); y -= 26; }
  } else {
    drawCentered(page, data.courseTitle, y, titleSize, helvBold, INK, W);
    y -= 26;
  }

  if (data.teacherName) {
    y -= 12;
    drawCentered(page, `under the teaching of ${data.teacherName}`, y, 13, serifItalic, INK, W);
  }

  // Divider + footer sit a fixed gap below wherever the content actually
  // ended (title wraps to 1-2 lines; the teacher line is optional), so short
  // and tall certificates both read as balanced instead of leaving a large
  // empty gap above a footer pinned to an absolute position. A floor keeps
  // the footer clear of the bottom frame when content runs long.
  const dividerY = Math.max(y - 40, 148);
  page.drawLine({ start: { x: W / 2 - 54, y: dividerY }, end: { x: W / 2 + 54, y: dividerY }, thickness: 1, color: accent });

  const footerRuleY = dividerY - 26;
  page.drawLine({ start: { x: W / 2 - 90, y: footerRuleY }, end: { x: W / 2 + 90, y: footerRuleY }, thickness: 0.5, color: FAINT });
  const issued = data.issuedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  drawCentered(page, `Issued ${issued}`, footerRuleY - 16, 11, helv, MUTED, W);
  drawCentered(page, `Certificate No. ${data.certNumber}`, footerRuleY - 34, 9, helv, FAINT, W);

  return pdf.save();
}

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAuth(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    // Identity comes ONLY from the verified token — never a client-supplied
    // userId. Any `userId` in the body is intentionally ignored.
    const { uid, email, tenantId: userTenantId, isSuperAdmin } = userOrResponse;

    let body: { courseId?: string } = {};
    try { body = await request.json(); } catch { /* validated below */ }
    const courseId = typeof body.courseId === 'string' ? body.courseId : '';
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
    }

    // ── Server-read the course (Admin SDK) ──────────────────────────────────
    // Two kinds of course can reach here, and until THE-54 only one existed:
    //   • a TENANT course, /courses/{id}, carrying a tenantId; or
    //   • a PLATFORM LIBRARY course, /libraryCourses/{id}, carrying none, which
    //     a church holds by adopting it (tenants/{t}/adoptedCourses/{id}).
    // Without the fallback below, every adopted course 404s here — completion
    // is real, the button is there, and the certificate can never be issued.
    let courseSnap = await adminDb.collection('courses').doc(courseId).get();
    let isLibraryCourse = false;
    if (!courseSnap.exists) {
      const librarySnap = await adminDb.collection('libraryCourses').doc(courseId).get();
      if (librarySnap.exists) {
        courseSnap = librarySnap;
        isLibraryCourse = true;
      }
    }
    if (!courseSnap.exists) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const course = { id: courseSnap.id, ...(courseSnap.data() as any) } as Course & { tenantId?: string };

    if (isLibraryCourse) {
      // ADOPTION IS THE ENTITLEMENT. A library course carries no tenantId, so
      // the tenant check below cannot bind — without this, ANY authenticated
      // user of ANY church could certify ANY catalogue course their church
      // never adopted, simply by knowing its id (the catalogue is readable by
      // every authenticated user, by design). The adoption record is the proof
      // the church actually holds this course.
      if (!isSuperAdmin) {
        if (!userTenantId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const adoption = await adminDb
          .collection('tenants').doc(userTenantId)
          .collection('adoptedCourses').doc(courseId)
          .get();
        if (!adoption.exists) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    } else if (!isSuperAdmin && course.tenantId && userTenantId && course.tenantId !== userTenantId) {
      // Tenant isolation: a learner may only certify a course in their own
      // tenant (tenant courses are tenant-scoped). Super admins are exempt.
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (course.issueCertificate !== true) {
      return NextResponse.json({ error: 'This course does not issue certificates' }, { status: 403 });
    }

    // ── Server-read the AUTHED user's own progress (Admin SDK) ──────────────
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : {};
    const completedLessons: string[] = Array.isArray(userData.completedLessons) ? userData.completedLessons : [];
    const quizAttempts: Record<string, QuizAttempt | undefined> =
      userData.quizAttempts && typeof userData.quizAttempts === 'object' ? userData.quizAttempts : {};

    // ── Recompute completion server-side; refuse if not genuinely met ───────
    const result = verifyCourseCompletion(course, completedLessons, quizAttempts);
    if (!result.complete) {
      return NextResponse.json(
        {
          error: 'Course not completed',
          missingLessons: result.missingLessons.length,
          unpassedQuizzes: result.unpassedQuizzes.length,
        },
        { status: 403 },
      );
    }

    // ── Learner name (server-read; never client input) ──────────────────────
    const learnerName: string =
      (typeof userData.displayName === 'string' && userData.displayName.trim()) ||
      (typeof userData.name === 'string' && userData.name.trim()) ||
      (email ? email.split('@')[0] : '') ||
      'Learner';

    // ── Teacher/author name (server-read from the course's first author) ────
    // A library course's authorIds resolve against libraryAuthors, NOT the
    // tenant-scoped authors collection — the two are separate namespaces, and
    // looking an adopted course's author up in `authors` finds nothing, so the
    // certificate silently loses its teacher name.
    let teacherName: string | undefined;
    const authorsCollection = isLibraryCourse ? 'libraryAuthors' : 'authors';
    const firstAuthorId = Array.isArray(course.authorIds) ? course.authorIds[0] : undefined;
    if (firstAuthorId) {
      try {
        const authorSnap = await adminDb.collection(authorsCollection).doc(firstAuthorId).get();
        const an = authorSnap.exists ? (authorSnap.data() as any)?.name : undefined;
        if (typeof an === 'string' && an.trim()) teacherName = an.trim();
      } catch { /* author is optional on the cert */ }
    }

    // ── Tenant branding (plan-gated on customBranding) ──────────────────────
    // For an ADOPTED library course this resolves to the LEARNER's tenant: a
    // library course has no tenantId, so it falls through to userTenantId. That
    // is the intended answer — the certificate carries the adopting church's
    // name and logo (subject to their plan), not Harvest's, because the course
    // is theirs to teach even though the content is the platform's.
    const resolvedTenantId = course.tenantId || userTenantId || PLATFORM_TENANT_ID;
    let ministryName = 'Harvest';
    let branded = false;
    let accent = { ...DEFAULT_ACCENT };
    let logo: unknown = null;
    try {
      const tenantSnap = await adminDb.collection('tenants').doc(resolvedTenantId).get();
      if (tenantSnap.exists) {
        const tData = tenantSnap.data() as any;
        const plan = (tData.plan as TenantPlan) || 'plus';
        const canBrand = getPlanFeatures(plan).customBranding;
        if (canBrand) {
          branded = true;
          if (typeof tData.name === 'string' && tData.name.trim()) ministryName = tData.name.trim();
          const parsed = hexToRgb(tData.config?.primaryColor);
          if (parsed) accent = parsed; // else keep the neutral gold default
          logo = tData.config?.logo ?? null;
        }
        // customBranding false → neutral Harvest styling: no logo, gold accent,
        // generic wordmark. Branding never leaks to plans that don't have it.
      }
    } catch (brandingErr) {
      // Best-effort by design, but the degraded outcome is invisible: a tenant
      // PAYING for customBranding silently gets the neutral Harvest certificate,
      // and the learner has no way to tell it was supposed to be branded.
      captureHandledError(brandingErr, {
        step: 'certificate-tenant-branding',
        level: 'warning',
        tenantId: resolvedTenantId,
        ids: { courseId },
      });
    }

    // ── Idempotency: deterministic id; preserve first issue date + number ───
    const certId = `${uid}_${courseId}`;
    const certRef = adminDb.collection('certificates').doc(certId);
    const existingSnap = await certRef.get();
    const existing = existingSnap.exists ? (existingSnap.data() as any) : null;
    const isFreshIssuance = !existing;
    const certNumber: string = existing?.certNumber || certNumberFor(uid, courseId);
    const issuedAt: Date = existing?.issuedAt ? new Date(existing.issuedAt) : new Date();

    // ── Build the PDF ───────────────────────────────────────────────────────
    const pdfBytes = await buildCertificatePdf({
      learnerName,
      courseTitle: course.title || 'Course',
      teacherName,
      ministryName,
      branded,
      accent,
      logo,
      issuedAt,
      certNumber,
    });

    // ── Store privately + record issuance (Admin SDK) ───────────────────────
    const filePath = `receipts/${resolvedTenantId}/certificates/${certId}.pdf`;
    const bucket = getReceiptsBucket();
    const file = bucket.file(filePath);
    await file.save(Buffer.from(pdfBytes), { metadata: { contentType: 'application/pdf' } });

    await certRef.set(
      {
        uid,
        courseId,
        courseTitle: course.title || 'Course',
        learnerName,
        teacherName: teacherName || null,
        tenantId: resolvedTenantId,
        certNumber,
        pdfPath: filePath,
        issuedAt: issuedAt.toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    // Short-lived signed URL — the cert is never served from a public path.
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });

    // Best-effort: email the cert PDF on first issuance only (never re-send on
    // a re-request of an already-issued cert). A Resend failure must not
    // affect issuance — the signed URL above is the guarantee.
    const resendKey = process.env.RESEND_API_KEY;
    if (isFreshIssuance && resendKey && email) {
      try {
        const resend = new Resend(resendKey);
        const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
        const courseTitle = course.title || 'Course';
        const slug = courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';
        const { error } = await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: email,
          subject: `Your certificate — ${courseTitle}`,
          html: `<p>Congratulations on completing <strong>${courseTitle}</strong>!</p><p>Your certificate is attached.</p>`,
          attachments: [{ filename: `certificate-${slug}.pdf`, content: pdfBase64 }],
        });
        if (error) console.error('Certificate email error:', error);
      } catch (err: any) {
        // Fires ONCE per certificate (first issuance only), so the learner's copy
        // of their certificate is simply never sent. The signed URL in the
        // response is the only other way they get it.
        console.error('Certificate email failed:', err?.message || err);
        captureHandledError(err, {
          step: 'certificate-email',
          level: 'warning',
          tenantId: resolvedTenantId,
          ids: { certificateId: certId, courseId },
        });
      }
    }

    return NextResponse.json({
      certificateId: certId,
      certificateNumber: certNumber,
      courseTitle: course.title || 'Course',
      issuedAt: issuedAt.toISOString(),
      url,
    });
  } catch (error) {
    console.error('Certificate error:', error);
    // Covers the gap between file.save() and certRef.set(): a PDF can land in the
    // bucket with no certificate record, and the next request then re-mints the
    // cert with a NEW issue date — the idempotency this route is built on.
    captureHandledError(error, { step: 'certificate-issue' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
