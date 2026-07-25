import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import * as admin from 'firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

const MULTICAST_LIMIT = 500;

export async function POST(request: NextRequest) {
  // Require auth — we check admin below
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  if (!user.isAdmin && !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const { title, body } = await request.json();

    if (!title || !body) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
    }

    // Use the admin's own tenantId — never trust client-supplied tenantId
    const tenantId = user.tenantId;
    if (!tenantId && !user.isSuperAdmin) {
      return NextResponse.json({ error: 'No tenant associated with this admin' }, { status: 400 });
    }

    // Get all users in the tenant that have FCM tokens
    const usersRef = adminDb.collection('users');
    const q = tenantId
      ? usersRef.where('tenantId', '==', tenantId)
      : usersRef; // superAdmin with no tenantId = all users

    const snapshot = await q.get();

    // Collect all FCM tokens, plus the email of every non-opted-out user who
    // has no token at all (they get the announcement by email instead).
    const tokens: string[] = [];
    const userTokenMap = new Map<string, string[]>(); // uid -> tokens for cleanup
    const tokenOwner = new Map<string, string>(); // token -> uid, to attribute per-token send failures
    const uidEmail = new Map<string, string>();
    const uidHasAnySuccess = new Map<string, boolean>(); // uid -> did at least one of their tokens send successfully
    const noTokenEmails: string[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      // notificationsEnabled === false is an explicit opt-out; undefined/true
      // (existing users predate this field) is treated as enabled.
      if (data.notificationsEnabled === false) return;
      const email = typeof data.email === 'string' ? data.email : '';
      if (Array.isArray(data.fcmTokens) && data.fcmTokens.length > 0) {
        tokens.push(...data.fcmTokens);
        userTokenMap.set(doc.id, data.fcmTokens);
        if (email) {
          uidEmail.set(doc.id, email);
          uidHasAnySuccess.set(doc.id, false);
          for (const token of data.fcmTokens) tokenOwner.set(token, doc.id);
        }
      } else if (email) {
        noTokenEmails.push(email);
      }
    });

    if (tokens.length === 0 && noTokenEmails.length === 0) {
      return NextResponse.json({ success: true, sent: 0, emailed: 0, message: 'No users with notifications enabled' });
    }

    // Send in chunks of 500 (FCM limit)
    const messaging = admin.messaging();
    let totalSent = 0;
    let totalFailed = 0;
    const invalidTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += MULTICAST_LIMIT) {
      const chunk = tokens.slice(i, i + MULTICAST_LIMIT);
      const message: admin.messaging.MulticastMessage = {
        notification: { title, body },
        tokens: chunk,
        webpush: {
          notification: {
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
          },
        },
      };

      const response = await messaging.sendEachForMulticast(message);
      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Collect invalid tokens, and track per-user send success for the email fallback.
      response.responses.forEach((resp, idx) => {
        const token = chunk[idx];
        const uid = tokenOwner.get(token);
        if (resp.success) {
          if (uid) uidHasAnySuccess.set(uid, true);
          return;
        }
        const error = resp.error;
        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(token);
        }
      });
    }

    // Users whose every token failed to send fall back to email too, same as
    // users with no token at all.
    for (const [uid, hadSuccess] of uidHasAnySuccess) {
      if (!hadSuccess) {
        const email = uidEmail.get(uid);
        if (email) noTokenEmails.push(email);
      }
    }

    // Clean up invalid tokens using arrayRemove (safe for concurrent updates)
    if (invalidTokens.length > 0) {
      let batch = adminDb.batch();
      let batchOps = 0;
      for (const entry of Array.from(userTokenMap.entries())) {
        const [uid, userTokens] = entry;
        const badTokens = userTokens.filter(t => invalidTokens.includes(t));
        if (badTokens.length > 0) {
          const userDoc = snapshot.docs.find(d => d.id === uid);
          if (userDoc) {
            for (const token of badTokens) {
              batch.update(userDoc.ref, {
                fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
              });
              batchOps++;
            }
          }
        }
        // Firestore batch limit is 500
        if (batchOps >= 490) {
          await batch.commit();
          batch = adminDb.batch(); // Create new batch after commit
          batchOps = 0;
        }
      }
      if (batchOps > 0) await batch.commit();
    }

    // Best-effort email fallback for opted-in users with no working push
    // token. A Resend failure here must not fail the overall request — push
    // delivery to everyone else already succeeded.
    let totalEmailed = 0;
    // Reported ONCE after the loop rather than per recipient: a Resend outage on a
    // 500-person announcement would otherwise burn 500 Sentry events to say one
    // thing. The count is the signal; the address never leaves this function.
    let emailFallbackFailures = 0;
    let lastEmailFallbackError: unknown = null;
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && noTokenEmails.length > 0) {
      const resend = new Resend(resendKey);
      const uniqueEmails = Array.from(new Set(noTokenEmails));
      for (const to of uniqueEmails) {
        try {
          const { error } = await resend.emails.send({
            from: 'Harvest <noreply@theharvest.app>',
            to,
            subject: title,
            html: `<p>${body}</p>`,
          });
          if (error) console.error(`Announcement email failed for ${to}:`, error);
          else totalEmailed++;
        } catch (err: any) {
          console.error(`Announcement email failed for ${to}:`, err?.message || err);
          emailFallbackFailures++;
          lastEmailFallbackError = err;
        }
      }
    }

    // These users opted IN to announcements and got neither a push nor an email.
    // The response reports `emailed` but never says how many were missed.
    if (emailFallbackFailures > 0) {
      captureHandledError(lastEmailFallbackError, {
        step: 'push-announcement-email-fallback',
        level: 'warning',
        tenantId,
        ids: { failedCount: String(emailFallbackFailures) },
      });
    }

    return NextResponse.json({ success: true, sent: totalSent, failed: totalFailed, emailed: totalEmailed });
  } catch (error) {
    console.error('Send notification error:', error);
    // The multicast may have already delivered to part of the tenant before this
    // threw, so the admin sees a flat failure for an announcement that half went
    // out — and re-sending double-notifies everyone who did receive it.
    captureHandledError(error, { step: 'push-announcement', tenantId: user.tenantId });
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
