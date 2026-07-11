import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { requireAuth } from '@/lib/api-auth';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import { getPlanFeatures } from '@/utils/plan-features';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { getAllLessons, isCourseComplete } from '@/utils/course.utils';
import type { Course, QuizAttempt } from '@/types/course.types';
import type { TenantPlan } from '@/types/tenant.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Issue a course completion certificate — server-verified and un-fakeable.
 *
 * POST body: { courseId: string }
 *
 * The learner is ALWAYS the authenticated token uid; there is no client-supplied
 * userId anywhere. Completion is recomputed server-side from Firestore (the
 * uid's own users doc + the course structure) via the shared isCourseComplete
 * rule — a client cannot get a cert by asserting completion. The cert record is
 * keyed deterministically at certificates/{uid}_{courseId} so re-requesting is
 * idempotent (same cert, no duplicate). The PDF is stored in the private
 * receipts bucket and handed back as a short-lived signed URL, never a public
 * path. Tenant branding (logo/color/name) is applied only when the owning
 * tenant's plan has customBranding; otherwise a neutral Harvest cert is issued.
 */

const DEFAULT_ACCENT = rgb(0.788, 0.588, 0.227); // #C9963A — Harvest wheat gold
const INK = rgb(0.176, 0.145, 0.098);            // #2D2519 — earth heading
const MUTED = rgb(0.42, 0.42, 0.42);

/** Validate a 6-digit hex color; return it only if well-formed, else null. */
function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

// The StandardFonts (Helvetica/Times) use WinAnsi encoding, which THROWS on any
// character it can't represent — e.g. the U+2009 thin space ICU sneaks into
// long-format dates, or a smart quote / emoji in a course title or learner
// name. Normalize typographic punctuation + all Unicode spaces to ASCII and
// drop anything outside the WinAnsi-safe range, so odd input degrades the text
// instead of 500-ing the whole cert. Keyed by code point (no exotic literals).
const TYPO_MAP: Record<number, string> = {
  0x2018: "'", 0x2019: "'", 0x201a: "'", 0x201b: "'",
  0x201c: '"', 0x201d: '"', 0x201e: '"',
  0x2013: '-', 0x2014: '-', 0x2015: '-', 0x2212: '-', 0x2022: '-',
  0x2026: '...',
};
function safeText(input: unknown): string {
  const chars = Array.from(String(input ?? ''));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0) || 0;
    if (TYPO_MAP[cp] !== undefined) { out += TYPO_MAP[cp]; continue; }
    // Any Unicode space separator (thin/narrow/nbsp/ideographic/…) → ASCII space.
    if (cp === 9 || cp === 10 || cp === 0xa0 || cp === 0x3000 ||
        (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f) {
      out += ' '; continue;
    }
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0xa0)) continue; // control chars: drop
    if (cp <= 0x7e) { out += ch; continue; }               // printable ASCII
    if (cp >= 0xa1 && cp <= 0xff) { out += ch; continue; }  // Latin-1 (WinAnsi-safe)
    // Anything else (CJK, emoji, zero-width, …): drop rather than crash the cert.
  }
  return out;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** ASCII-only long date (avoids ICU's thin/narrow spaces that WinAnsi rejects). */
function formatIssuedDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Deterministic, human-readable certificate number derived purely from the
 * cert id (`${uid}_${courseId}`) — stable across re-issues, no randomness. FNV-1a
 * → base36 keeps it short and stable without pulling in crypto.
 */
function certNumberFrom(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const code = (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
  return `HC-${code}`;
}

interface LogoImage {
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
}

/**
 * Reject URLs pointing at private / loopback / link-local hosts or non-standard
 * ports before the server fetches them. `config.logo` is set by the tenant admin,
 * so the server-side fetch is an SSRF surface; the image magic-byte check already
 * blocks exfiltration (non-image responses never embed), and this closes blind
 * SSRF to internal services. A hostname (not IP literal) is allowed — the
 * downstream fetch resolves it — but obvious internal targets are blocked.
 */
function isSafeLogoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.internal') || host.endsWith('.local') || host === '[::1]') {
    return false;
  }
  // IPv4 literal in a private / loopback / link-local / CGNAT range.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0 || a === 169 && b === 254 ||
        a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 ||
        a === 100 && b >= 64 && b <= 127) {
      return false;
    }
  }
  return true;
}

/**
 * Best-effort fetch of the tenant logo for embedding. Only http(s) URLs to safe
 * hosts, a hard timeout, and a size cap — any failure returns null so the cert
 * still issues without the logo rather than failing the whole request (graceful
 * degrade).
 */
async function fetchLogo(url: unknown): Promise<LogoImage | null> {
  if (typeof url !== 'string' || !isSafeLogoUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 5_000_000) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const lower = url.toLowerCase();
    // Sniff the magic bytes first (Cloudinary often omits an extension); fall
    // back to content-type / extension hints.
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    if (isPng || ct.includes('png') || lower.endsWith('.png')) return { bytes: buf, kind: 'png' };
    if (isJpg || ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g($|\?)/i.test(lower)) {
      return { bytes: buf, kind: 'jpg' };
    }
    return null; // unknown/unsupported format (svg, webp, gif) — skip, don't fail
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface CertContent {
  learnerName: string;
  courseTitle: string;
  teacherName: string;
  ministryName: string;
  issuedDate: string;   // display date
  certNumber: string;
  accent: RGB;
  logo: LogoImage | null;
}

function drawCentered(
  page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB, pageWidth: number
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageWidth - width) / 2, y, size, font, color });
}

/** Fit a single line to a max width by trimming characters with an ellipsis. */
function fitLine(text: string, size: number, font: PDFFont, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '...';
}

async function buildCertificatePdf(raw: CertContent): Promise<Uint8Array> {
  // Sanitize every dynamic string once, up front, so width measurement and
  // drawing both operate on WinAnsi-safe text.
  const learnerName = safeText(raw.learnerName) || 'Learner';
  const courseTitle = safeText(raw.courseTitle) || 'Course';
  const teacherName = safeText(raw.teacherName);
  const ministryName = safeText(raw.ministryName);
  const issuedDate = safeText(raw.issuedDate);
  const certNumber = safeText(raw.certNumber);

  const pdf = await PDFDocument.create();
  const W = 842, H = 595; // A4 landscape
  const page = pdf.addPage([W, H]);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  // Outer accent border + a thin inner keyline.
  page.drawRectangle({ x: 26, y: 26, width: W - 52, height: H - 52, borderColor: raw.accent, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: raw.accent, borderWidth: 0.75, borderOpacity: 0.5 });

  let y = H - 96;

  // Optional tenant logo, centered at the top.
  if (raw.logo) {
    try {
      const img = raw.logo.kind === 'png' ? await pdf.embedPng(raw.logo.bytes) : await pdf.embedJpg(raw.logo.bytes);
      const maxH = 56, maxW = 200;
      const scale = Math.min(maxH / img.height, maxW / img.width, 1);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: (W - w) / 2, y: y - h + 20, width: w, height: h });
      y -= h - 6;
    } catch {
      // Embed failed on already-fetched bytes — degrade to no logo.
    }
  }

  if (ministryName) {
    drawCentered(page, ministryName, y, 13, sansBold, INK, W);
    y -= 26;
  }

  drawCentered(page, 'CERTIFICATE OF COMPLETION'.split('').join(' '), y, 12, sansBold, raw.accent, W);
  y -= 34;

  drawCentered(page, 'This certifies that', y, 12, sans, MUTED, W);
  y -= 44;

  drawCentered(page, fitLine(learnerName, 34, serif, W - 160), y, 34, serif, INK, W);
  y -= 34;

  drawCentered(page, 'has successfully completed', y, 12, sans, MUTED, W);
  y -= 34;

  drawCentered(page, fitLine(courseTitle, 20, sansBold, W - 140), y, 20, sansBold, INK, W);
  y -= 26;

  if (teacherName) {
    drawCentered(page, fitLine(`under the teaching of ${teacherName}`, 13, serifItalic, W - 160), y, 13, serifItalic, INK, W);
    y -= 22;
  }

  // Accent divider.
  page.drawLine({ start: { x: W / 2 - 90, y: 120 }, end: { x: W / 2 + 90, y: 120 }, thickness: 1, color: raw.accent });

  // Footer: issue date (left) + certificate number (right), inside the border.
  page.drawText(`Issued ${issuedDate}`, { x: 70, y: 70, size: 10, font: sans, color: MUTED });
  const certLabel = `Certificate No. ${certNumber}`;
  page.drawText(certLabel, { x: W - 70 - sans.widthOfTextAtSize(certLabel, 10), y: 70, size: 10, font: sans, color: MUTED });
  drawCentered(page, 'Verify at theharvest.app', 52, 8, sans, rgb(0.6, 0.6, 0.6), W);

  return pdf.save();
}

export async function POST(request: NextRequest) {
  try {
    const authed = await requireAuth(request);
    if (authed instanceof NextResponse) return authed;
    // Identity is the verified token uid ONLY — never a client-supplied userId.
    const { uid } = authed;

    let body: { courseId?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      /* handled below */
    }
    const courseId = typeof body.courseId === 'string' ? body.courseId.trim() : '';
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
    }

    // ── Read the course (Admin SDK) ───────────────────────────────────────────
    const courseSnap = await adminDb.collection('courses').doc(courseId).get();
    if (!courseSnap.exists) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const courseData = courseSnap.data() || {};
    const course = { id: courseSnap.id, ...courseData } as Course;

    if (course.issueCertificate !== true) {
      return NextResponse.json({ error: 'This course does not issue certificates' }, { status: 403 });
    }

    // Tenant scope: a learner may only certify a course in their own tenant.
    const courseTenantId = (courseData.tenantId as string | undefined) || '';
    if (courseTenantId && authed.tenantId && courseTenantId !== authed.tenantId && !authed.isSuperAdmin) {
      return NextResponse.json({ error: 'Course not available in your tenant' }, { status: 403 });
    }

    // ── Read the learner's OWN progress (Admin SDK, keyed by token uid) ────────
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const completed = new Set<string>(
      Array.isArray(userData.completedLessons) ? (userData.completedLessons as string[]) : []
    );
    const quizAttempts = (userData.quizAttempts || {}) as Record<string, QuizAttempt | undefined>;

    const allLessons = getAllLessons(course);
    if (allLessons.length === 0) {
      return NextResponse.json({ error: 'Course has no lessons' }, { status: 403 });
    }

    // ── Independent completion verification (shared rule, not a client claim) ──
    if (!isCourseComplete(course, completed, quizAttempts)) {
      return NextResponse.json({ error: 'Course not completed' }, { status: 403 });
    }

    // ── Resolve display data from server-read docs (never client input) ───────
    const learnerName =
      (typeof userData.displayName === 'string' && userData.displayName.trim()) ||
      (typeof userData.name === 'string' && userData.name.trim()) ||
      (typeof authed.email === 'string' && authed.email) ||
      'Learner';

    let teacherName = '';
    const firstAuthorId = Array.isArray(course.authorIds) ? course.authorIds[0] : undefined;
    if (firstAuthorId) {
      try {
        const authorSnap = await adminDb.collection('authors').doc(firstAuthorId).get();
        if (authorSnap.exists) {
          const an = authorSnap.data()?.name;
          if (typeof an === 'string') teacherName = an.trim();
        }
      } catch {
        /* teacher is optional — degrade */
      }
    }

    // ── Branding tenant + plan gate (customBranding) ──────────────────────────
    const brandingTenantId = courseTenantId || authed.tenantId || PLATFORM_TENANT_ID;
    let ministryName = '';
    let accent = DEFAULT_ACCENT;
    let logo: LogoImage | null = null;
    try {
      const tenantSnap = await adminDb.collection('tenants').doc(brandingTenantId).get();
      if (tenantSnap.exists) {
        const tData = tenantSnap.data() || {};
        const plan = (tData.plan as TenantPlan) || 'plus';
        if (getPlanFeatures(plan).customBranding) {
          if (typeof tData.name === 'string') ministryName = tData.name.trim();
          const hex = normalizeHex(tData.config?.primaryColor);
          if (hex) accent = hexToRgb(hex);
          logo = await fetchLogo(tData.config?.logo);
        }
      }
    } catch {
      // Branding is optional — a tenant-read failure falls back to neutral styling.
    }

    // ── Deterministic, idempotent cert record ─────────────────────────────────
    const certId = `${uid}_${courseId}`;
    const certRef = adminDb.collection('certificates').doc(certId);
    const existing = await certRef.get();
    const issuedAtIso: string =
      (existing.exists && typeof existing.data()?.issuedAt === 'string')
        ? (existing.data()!.issuedAt as string)
        : new Date().toISOString();
    const certNumber = certNumberFrom(certId);
    const courseTitle = typeof course.title === 'string' ? course.title : 'Course';

    const pdfBytes = await buildCertificatePdf({
      learnerName, courseTitle, teacherName, ministryName,
      issuedDate: formatIssuedDate(issuedAtIso), certNumber, accent, logo,
    });

    // ── Private storage + short-lived signed URL (never a public path) ────────
    const pdfPath = `receipts/${brandingTenantId}/certificates/${certId}.pdf`;
    const bucket = getReceiptsBucket();
    const file = bucket.file(pdfPath);
    await file.save(Buffer.from(pdfBytes), { metadata: { contentType: 'application/pdf' } });

    // Persist the auditable, re-issue-stable cert record (Admin SDK write only).
    await certRef.set(
      {
        uid,
        courseId,
        courseTitle,
        learnerName,
        teacherName,
        tenantId: brandingTenantId,
        certNumber,
        pdfPath,
        issuedAt: issuedAtIso,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });

    return NextResponse.json({ url, certId, certNumber, courseTitle, issuedAt: issuedAtIso });
  } catch (error) {
    console.error('Certificate issue error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
