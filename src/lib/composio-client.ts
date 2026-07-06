/**
 * Composio API Client
 *
 * Thin wrapper over the official Composio v3 SDK (`@composio/core`) used to
 * manage OAuth connections and execute tools for the Instagram / Mailchimp /
 * QuickBooks integrations.
 *
 * Migrated from the removed v2 REST API (`backend.composio.dev/api/v2`) which
 * now returns 410 for every call. All usage here is *direct* tool execution
 * (`composio.tools.execute`) — every call names a specific tool with explicit
 * inputs, so we deliberately do NOT use the agentic "sessions" model.
 */

import { createHmac } from 'crypto';
import { Composio } from '@composio/core';

// ── SDK singleton ───────────────────────────────────────────────────────────

let composioSingleton: Composio | null = null;

/**
 * Lazily construct a single, module-scoped Composio client.
 *
 * The v3 SDK only needs the API key — it is project-scoped, so it resolves to
 * the correct project automatically (no project id required).
 */
function getComposio(): Composio {
  if (composioSingleton) return composioSingleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY environment variable is not set');
  }
  composioSingleton = new Composio({ apiKey });
  return composioSingleton;
}

/**
 * v3 requires a `userId` on connection + execution calls. We use a composite,
 * tenant-scoped id so every admin's connections are isolated: a connection
 * created under `tenantId:uid` is a PRIVATE connected account usable ONLY by
 * that exact userId (the v3 backend denies any other caller by default).
 *
 * IMPORTANT: the same userId that created a connection must be used to execute
 * against it. When a connection is shared across a tenant (e.g. the primary
 * admin's Mailchimp/QuickBooks connection), execution must pass the *owner's*
 * uid — not necessarily the requesting admin's.
 */
export function composioUserId(tenantId: string, uid: string): string {
  return `${tenantId}:${uid}`;
}

function getStateSecret(): string {
  const secret = process.env.COMPOSIO_STATE_SECRET;
  if (!secret) {
    throw new Error('COMPOSIO_STATE_SECRET environment variable is not set');
  }
  return secret;
}

// ── Fix 1: HMAC-signed state for callback authentication ────────────────────

/**
 * Create an HMAC-signed state parameter for OAuth callback verification.
 * Encodes {tenantId, uid, ts} with an HMAC-SHA256 signature as base64.
 */
export function createSignedState(tenantId: string, uid: string): string {
  const ts = Date.now();
  const payload = JSON.stringify({ tenantId, uid, ts });
  const signature = createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('hex');
  const stateData = JSON.stringify({ payload, signature });
  return Buffer.from(stateData).toString('base64');
}

/**
 * Verify and decode an HMAC-signed state parameter.
 * Throws if the signature is invalid.
 */
export function verifySignedState(
  state: string
): { tenantId: string; uid: string; ts: number } {
  const decoded = Buffer.from(state, 'base64').toString('utf-8');
  let stateData: { payload: string; signature: string };
  try {
    stateData = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid state format');
  }

  const { payload, signature } = stateData;
  if (!payload || !signature) {
    throw new Error('Invalid state structure');
  }

  const expectedSignature = createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('hex');

  // Timing-safe comparison
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length || !sigBuf.equals(expectedBuf)) {
    throw new Error('Invalid state signature');
  }

  const parsed = JSON.parse(payload);

  // Age validation: reject states older than 15 minutes
  if (Date.now() - parsed.ts > 15 * 60 * 1000) {
    throw new Error('State expired (max 15 minutes)');
  }

  return parsed;
}

// ── Composio v3 SDK operations ──────────────────────────────────────────────

/**
 * Execute a Composio tool/action via direct (non-agentic) execution.
 *
 * @param action - The tool slug (e.g. 'MAILCHIMP_GET_LISTS')
 * @param input - The tool arguments
 * @param connectedAccountId - The connected account to run against
 * @param tenantId - Tenant of the connection OWNER
 * @param uid - uid of the connection OWNER (the admin who connected the account)
 *
 * Returns the raw v3 result `{ data, error, successful, logId }`; the tool's
 * output payload is under `.data`. Throws (like the old v2 client did on a
 * non-2xx) when the tool reports failure, so callers' existing try/catch
 * blocks treat it as a failure instead of silently proceeding with empty data.
 */
export async function executeComposioAction(
  action: string,
  input: Record<string, any>,
  connectedAccountId: string,
  tenantId: string,
  uid: string
): Promise<any> {
  const composio = getComposio();
  const result = await composio.tools.execute(action, {
    userId: composioUserId(tenantId, uid),
    connectedAccountId,
    arguments: input,
    // The SDK defaults the toolkit version to "latest", which makes execute()
    // throw ComposioToolVersionRequiredError unless we pin a version or skip the
    // check. These are direct calls to stable Mailchimp/QuickBooks/Instagram
    // tools where we always want current behavior, so we skip the pin.
    dangerouslySkipVersionCheck: true,
  });

  // v3 returns { data, successful, error } — surface tool-level failures as
  // thrown errors (e.g. a failed QuickBooks receipt would otherwise be treated
  // as empty data and marked "synced"). `error` is a tool message, not a token.
  if (result && result.successful === false) {
    throw new Error(
      `Composio action ${action} failed: ${result.error ?? 'unknown error'}`
    );
  }

  return result;
}

/**
 * Initiate an OAuth connection flow for an app using a managed-OAuth auth config.
 *
 * Uses `connectedAccounts.link()` — the correct v3 flow for Composio-managed
 * OAuth (the legacy `.initiate()` create-path is deprecated/blocked for managed
 * OAuth). Returns a redirect URL where the user should be sent to authorize.
 *
 * @param authConfigId - The Composio auth config id (`ac_...`)
 * @param callbackUrl - URL to redirect to after OAuth completes
 * @param tenantId - Tenant of the connecting admin
 * @param uid - uid of the connecting admin (becomes the connection owner)
 */
export async function initiateConnection(
  authConfigId: string,
  callbackUrl: string,
  tenantId: string,
  uid: string
): Promise<{ connectedAccountId: string; redirectUrl: string }> {
  const composio = getComposio();
  const req = await composio.connectedAccounts.link(
    composioUserId(tenantId, uid),
    authConfigId,
    { callbackUrl }
  );

  const connectedAccountId = req.id;
  const redirectUrl = req.redirectUrl;

  if (!connectedAccountId) {
    throw new Error('Composio returned no connection id');
  }
  if (!redirectUrl) {
    throw new Error('Composio returned no redirect url');
  }

  return { connectedAccountId, redirectUrl };
}

/**
 * Get the status and details of a connection.
 *
 * @param connectedAccountId - The connected account id to check
 *
 * The return shape is kept stable for callers. Note that v3 has no
 * non-sensitive `metadata` field on the account — `state`/`data`/`params` hold
 * raw OAuth credentials, so we deliberately do NOT surface them.
 */
export async function getConnectionStatus(
  connectedAccountId: string
): Promise<{
  id: string;
  status: string;
  appName: string;
  metadata?: Record<string, any>;
}> {
  const composio = getComposio();
  const acct = await composio.connectedAccounts.get(connectedAccountId);
  return {
    id: acct.id,
    status: acct.status, // v3 statuses are UPPERCASE: 'ACTIVE' | 'INITIATED' | 'FAILED' | ...
    appName: acct.toolkit?.slug ?? '', // v3 nests the app under toolkit.slug
    metadata: undefined,
  };
}

/**
 * Delete/disconnect a connected account.
 * @param connectedAccountId - The connected account id to delete
 */
export async function deleteConnection(connectedAccountId: string): Promise<void> {
  const composio = getComposio();
  await composio.connectedAccounts.delete(connectedAccountId);
}
