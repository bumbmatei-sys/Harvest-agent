import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { authorizeSocialActor, type SocialAccess, type SocialActor } from './access';
import {
  consumeConfirmToken,
  hashCancelledPost,
  hashSocialDraft,
  issueConfirmToken,
  type ConfirmAction,
} from './confirm-token';
import { isIdempotencyKey, parseConnectPlatform, parseSocialDraft } from './draft';
import {
  cancelSocialPost,
  connectSocialAccount,
  createSocialPost,
  loadSocialWorkspace,
  updateSocialPost,
} from './session';
import { workspaceTimeZone } from './schedule-time';
import type { SocialPost, SocialPostDraft, SocialWorkspace } from './types';

/**
 * Every social read and write the signed-in person can do.
 *
 * Routes and the scheduler UI call these functions and do not repeat the
 * rules. A future assistant calls the same functions with the same actor, so
 * it can see and do only what that person can, inside that person's ministry.
 *
 * Schedule, publish, update and cancel are preview-then-confirm. A preview
 * names the ministry, the platforms, the text and the time, and writes
 * nothing except a single-use token. Confirm presents that token. The server
 * checks it against the action, ministry, person, post and draft, consumes
 * it, and only then performs the action.
 */

export type { SocialActor };

export type SocialErrorCode =
  | 'platform_not_offered'
  | 'post_incomplete'
  | 'schedule_invalid'
  | 'media_not_accepted'
  | 'youtube_needs_video'
  | 'tiktok_needs_video'
  | 'idempotency_key_required'
  | 'confirm_token_required'
  | 'confirm_invalid'
  | 'account_not_owned'
  | 'post_not_editable'
  | 'social_unavailable'
  | 'social_scheduler_not_entitled'
  | 'Admin access required'
  | 'No tenant associated with this account'
  | 'Access denied to this tenant'
  | 'Tenant not found'
  | 'Unauthorized';

export type SocialResult<T> =
  | { readonly ok: true; readonly status: 200; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: SocialErrorCode };

export type SocialActionKind = 'schedule' | 'publish' | 'update' | 'cancel' | 'draft';

export interface SocialActionPreview {
  readonly action: SocialActionKind;
  readonly ministryId: string;
  readonly ministryName: string;
  readonly platforms: readonly string[];
  readonly content: string;
  readonly scheduledFor: string | null;
  readonly publishNow: boolean;
  readonly postId: string | null;
}

export interface SocialPreviewResult {
  readonly preview: SocialActionPreview;
  readonly requiresConfirm: true;
  readonly confirmToken: string;
  readonly sample: boolean;
}

const KNOWN_ERRORS = new Set<string>([
  'platform_not_offered',
  'post_incomplete',
  'schedule_invalid',
  'media_not_accepted',
  'youtube_needs_video',
  'tiktok_needs_video',
  'idempotency_key_required',
  'confirm_token_required',
  'confirm_invalid',
  'account_not_owned',
  'post_not_editable',
  'social_unavailable',
  'social_scheduler_not_entitled',
  'Admin access required',
  'No tenant associated with this account',
  'Access denied to this tenant',
  'Tenant not found',
  'Unauthorized',
]);

function fail(error: SocialErrorCode, status: number): SocialResult<never> {
  return { ok: false, status, error };
}

function ok<T>(data: T): SocialResult<T> {
  return { ok: true, status: 200, data };
}

function statusForMutation(error: 'account_not_owned' | 'social_unavailable' | 'post_not_editable'): number {
  if (error === 'account_not_owned') return 403;
  if (error === 'post_not_editable') return 404;
  return 503;
}

async function fromResponse(response: NextResponse): Promise<SocialResult<never>> {
  let error: SocialErrorCode = 'social_unavailable';
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && KNOWN_ERRORS.has(body.error)) {
      error = body.error as SocialErrorCode;
    }
  } catch (caught) {
    console.error('Social scheduling could not read an access response', caught);
  }
  return { ok: false, status: response.status, error };
}

function readConfirmToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const token = (body as Record<string, unknown>).confirmToken;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function wantsConfirm(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as Record<string, unknown>).confirm === true);
}

function ownsAccounts(workspace: SocialWorkspace, draft: SocialPostDraft): boolean {
  const owned = new Set(workspace.accounts.map((account) => account.id));
  return draft.targets.every((target) => owned.has(target.accountId));
}

async function ministryLabel(access: SocialAccess): Promise<string> {
  if (access.sample) return 'Sample Ministry';
  try {
    const snap = await adminDb.collection('tenants').doc(access.tenantId).get();
    const data = snap.exists ? snap.data() || {} : {};
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name) return name;
  } catch (error) {
    console.error('Social scheduling could not read the ministry name', error);
  }
  return access.tenantId;
}

function previewFor(
  access: SocialAccess,
  ministryName: string,
  action: SocialActionKind,
  content: string,
  platforms: readonly string[],
  scheduledFor: string | null,
  publishNow: boolean,
  postId: string | null,
): SocialActionPreview {
  return {
    action,
    ministryId: access.tenantId,
    ministryName,
    platforms,
    content,
    scheduledFor,
    publishNow,
    postId,
  };
}

interface Prepared {
  readonly access: SocialAccess;
  readonly draft: SocialPostDraft;
  readonly workspace: SocialWorkspace;
  readonly ministryName: string;
}

async function prepare(actor: SocialActor, body: unknown): Promise<Prepared | SocialResult<never>> {
  const access = await authorizeSocialActor(actor);
  if (access instanceof NextResponse) return fromResponse(access);
  const parsed = parseSocialDraft(body);
  if (!parsed.ok) return fail(parsed.error, 400);
  const workspace = await loadSocialWorkspace(access.tenantId, new Date(), access.mockOnly);
  if (!workspace) return fail('social_unavailable', 503);
  if (!ownsAccounts(workspace, parsed.draft)) return fail('account_not_owned', 403);
  return {
    access,
    draft: parsed.draft,
    workspace,
    ministryName: await ministryLabel(access),
  };
}

function isPrepared(value: Prepared | SocialResult<never>): value is Prepared {
  return !('ok' in value && value.ok === false);
}

async function openOrSpend(
  actor: SocialActor,
  body: unknown,
  preview: SocialActionPreview,
  sample: boolean,
  draftHash: string,
): Promise<SocialResult<SocialPreviewResult> | { readonly proceed: true }> {
  const token = readConfirmToken(body);
  const binding = {
    action: preview.action as ConfirmAction,
    tenantId: preview.ministryId,
    uid: actor.uid,
    postId: preview.postId,
    draftHash,
  };
  if (!token) {
    if (wantsConfirm(body)) return fail('confirm_token_required', 400);
    const issued = await issueConfirmToken(binding);
    if (!issued) return fail('social_unavailable', 503);
    return ok({ preview, requiresConfirm: true, confirmToken: issued, sample });
  }
  const gate = await consumeConfirmToken(token, binding);
  if (gate !== 'ok') return fail('confirm_invalid', 400);
  return { proceed: true };
}

function isPreview(value: SocialResult<SocialPreviewResult> | { proceed: true }): value is SocialResult<SocialPreviewResult> {
  return !('proceed' in value);
}

export async function actorFromRequest(request: NextRequest): Promise<SocialActor | NextResponse> {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified === true,
    tenantId: user.tenantId,
    isSuperAdmin: user.isSuperAdmin,
    requestedTenantId: request.headers.get('x-harvest-tenant'),
  };
}

export function socialResponse(result: SocialResult<unknown>): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function list(actor: SocialActor, requestedTimeZone?: string | null): Promise<SocialResult<{
  entitled: boolean;
  sample: boolean;
  timezone: string;
  accounts: SocialWorkspace['accounts'];
  posts: SocialWorkspace['posts'];
}>> {
  const access = await authorizeSocialActor(actor);
  if (access instanceof NextResponse) return fromResponse(access);
  const workspace = await loadSocialWorkspace(access.tenantId, new Date(), access.mockOnly);
  if (!workspace) return fail('social_unavailable', 503);
  return ok({
    entitled: access.entitled,
    sample: access.sample,
    // A named zone (the sample ministry) stays. UTC is the live client's
    // unset sentinel, and the caller's IANA zone replaces only that.
    timezone: workspaceTimeZone(workspace.timezone, requestedTimeZone),
    accounts: workspace.accounts,
    posts: workspace.posts,
  });
}

export async function validate(actor: SocialActor, body: unknown): Promise<SocialResult<{
  draft: SocialPostDraft;
  preview: SocialActionPreview;
}>> {
  const prepared = await prepare(actor, body);
  if (!isPrepared(prepared)) return prepared;
  const action = prepared.draft.publishNow ? 'publish' : prepared.draft.scheduledFor ? 'schedule' : 'draft';
  return ok({
    draft: prepared.draft,
    preview: previewFor(
      prepared.access,
      prepared.ministryName,
      action,
      prepared.draft.content,
      prepared.draft.targets.map((target) => target.platform),
      prepared.draft.scheduledFor,
      prepared.draft.publishNow,
      null,
    ),
  });
}

export async function createDraft(
  actor: SocialActor,
  body: unknown,
): Promise<SocialResult<{ post: SocialPost; sample: boolean }>> {
  const row = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const prepared = await prepare(actor, { ...row, publishNow: false, scheduledFor: null, confirm: false });
  if (!isPrepared(prepared)) return prepared;
  const result = await createSocialPost(prepared.access.tenantId, prepared.draft, prepared.access.mockOnly);
  if (!result.ok) return fail(result.error, statusForMutation(result.error));
  return ok({ post: result.post, sample: prepared.access.sample });
}

export async function schedule(
  actor: SocialActor,
  body: unknown,
  idempotencyKey: string | null,
): Promise<SocialResult<SocialPreviewResult | { post: SocialPost; sample: boolean }>> {
  const prepared = await prepare(actor, body);
  if (!isPrepared(prepared)) return prepared;
  const action = prepared.draft.publishNow ? 'publish' : 'schedule';
  const preview = previewFor(
    prepared.access,
    prepared.ministryName,
    action,
    prepared.draft.content,
    prepared.draft.targets.map((target) => target.platform),
    prepared.draft.publishNow ? null : prepared.draft.scheduledFor,
    prepared.draft.publishNow,
    null,
  );
  if (!prepared.draft.publishNow && !prepared.draft.scheduledFor) {
    return fail('schedule_invalid', 400);
  }
  if (readConfirmToken(body) && !isIdempotencyKey(idempotencyKey)) {
    return fail('idempotency_key_required', 400);
  }
  const gate = await openOrSpend(actor, body, preview, prepared.access.sample, hashSocialDraft(prepared.draft));
  if (isPreview(gate)) return gate;
  const draft = {
    ...prepared.draft,
    idempotencyKey,
  };
  const result = await createSocialPost(prepared.access.tenantId, draft, prepared.access.mockOnly);
  if (!result.ok) return fail(result.error, statusForMutation(result.error));
  return ok({ post: result.post, sample: prepared.access.sample });
}

export async function update(
  actor: SocialActor,
  id: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<SocialResult<SocialPreviewResult | { post: SocialPost; sample: boolean }>> {
  const prepared = await prepare(actor, body);
  if (!isPrepared(prepared)) return prepared;
  const existing = prepared.workspace.posts.find((post) => post.id === id);
  if (!existing || existing.status === 'sent') return fail('post_not_editable', 404);
  const action = prepared.draft.publishNow ? 'publish' : 'update';
  const preview = previewFor(
    prepared.access,
    prepared.ministryName,
    action,
    prepared.draft.content,
    prepared.draft.targets.map((target) => target.platform),
    prepared.draft.scheduledFor,
    prepared.draft.publishNow,
    id,
  );
  // Schedule still requires a future time. An undated draft may be edited
  // without one. Omitting the time on a post that already has one is a refusal,
  // so a scheduled post cannot be saved back into an undated draft by accident.
  if (!prepared.draft.publishNow && !prepared.draft.scheduledFor && existing.scheduledFor) {
    return fail('schedule_invalid', 400);
  }
  if (prepared.draft.publishNow && readConfirmToken(body) && !isIdempotencyKey(idempotencyKey)) {
    return fail('idempotency_key_required', 400);
  }
  const gate = await openOrSpend(actor, body, preview, prepared.access.sample, hashSocialDraft(prepared.draft));
  if (isPreview(gate)) return gate;
  const draft = {
    ...prepared.draft,
    idempotencyKey: prepared.draft.publishNow ? idempotencyKey : null,
  };
  const result = await updateSocialPost(prepared.access.tenantId, id, draft, prepared.access.mockOnly);
  if (!result.ok) return fail(result.error, statusForMutation(result.error));
  return ok({ post: result.post, sample: prepared.access.sample });
}

export async function cancel(
  actor: SocialActor,
  id: string,
  body: unknown,
): Promise<SocialResult<SocialPreviewResult | { cancelled: true; sample: boolean }>> {
  const access = await authorizeSocialActor(actor);
  if (access instanceof NextResponse) return fromResponse(access);
  const workspace = await loadSocialWorkspace(access.tenantId, new Date(), access.mockOnly);
  if (!workspace) return fail('social_unavailable', 503);
  const existing = workspace.posts.find((post) => post.id === id);
  if (!existing || existing.status === 'sent') return fail('post_not_editable', 404);
  const preview = previewFor(
    access,
    await ministryLabel(access),
    'cancel',
    existing.content,
    existing.targets.map((target) => target.platform),
    existing.scheduledFor,
    false,
    id,
  );
  const gate = await openOrSpend(actor, body, preview, access.sample, hashCancelledPost(existing));
  if (isPreview(gate)) return gate;
  const removed = await cancelSocialPost(access.tenantId, id, access.mockOnly);
  if (!removed) return fail('post_not_editable', 404);
  return ok({ cancelled: true, sample: access.sample });
}

export async function connectAccount(
  actor: SocialActor,
  body: unknown,
): Promise<SocialResult<{ platform: string; authUrl: string | null; sample: boolean }>> {
  const access = await authorizeSocialActor(actor);
  if (access instanceof NextResponse) return fromResponse(access);
  const platform = parseConnectPlatform(body);
  if (!platform) return fail('platform_not_offered', 400);
  const result = await connectSocialAccount(access.tenantId, platform, access.mockOnly);
  if (!result.ok) return fail('social_unavailable', 503);
  return ok({ platform, authUrl: result.authUrl, sample: result.sample });
}

/** The posts route's one call. A draft flag saves a draft; anything else is schedule or publish. */
export async function submitPost(
  actor: SocialActor,
  body: unknown,
  idempotencyKey: string | null,
): Promise<SocialResult<SocialPreviewResult | { post: SocialPost; sample: boolean }>> {
  const draft = Boolean(body && typeof body === 'object' && (body as Record<string, unknown>).draft === true);
  if (draft) return createDraft(actor, body);
  return schedule(actor, body, idempotencyKey);
}
