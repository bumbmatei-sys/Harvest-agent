/**
 * Composio API Client
 * Generic HTTP client for Composio REST API v2
 * Used to manage OAuth connections and execute actions for integrations
 */

import { createHmac } from 'crypto';

const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v2';
const FETCH_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY environment variable is not set');
  }
  return apiKey;
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

// ── Fix 4: Fetch timeout + Fix 9: Safe JSON parsing ─────────────────────────

/**
 * Generic HTTP client for Composio API with API key authentication
 */
export async function composioRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  endpoint: string,
  body?: Record<string, any>
): Promise<any> {
  const url = `${COMPOSIO_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'x-api-key': getApiKey(),
    'Content-Type': 'application/json',
  };

  // Fix 4: AbortController with 10-second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const options: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.message || parsed.error || errorBody;
      } catch {
        errorMessage = errorBody;
      }
      throw new Error(
        `Composio API error [${method} ${endpoint}]: ${response.status} - ${errorMessage}`
      );
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return null;
    }

    // Fix 9: Safe JSON parsing for non-JSON responses
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Composio API error [${method} ${endpoint}]: Response was not valid JSON`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Execute a Composio action/tool
 * @param action - The action slug (e.g., 'INSTAGRAM_GET_USER_INFO')
 * @param input - The input parameters for the action
 * @param connectedAccountId - The connected account ID to use
 */
export async function executeComposioAction(
  action: string,
  input: Record<string, any>,
  connectedAccountId: string
): Promise<any> {
  return composioRequest('POST', '/actions/execute', {
    action,
    input,
    connectedAccountId,
  });
}

/**
 * Initiate an OAuth connection flow for an app
 * Returns a redirect URL where the user should be sent to authorize
 * @param appName - The app name (e.g., 'instagram', 'mailchimp')
 * @param callbackUrl - URL to redirect to after OAuth completes
 * @param metadata - Optional metadata to attach to the connection request
 */
export async function initiateConnection(
  appName: string,
  callbackUrl: string,
  metadata?: Record<string, string>
): Promise<{ connectedAccountId: string; redirectUrl: string }> {
  const body: Record<string, any> = {
    appName,
    callbackUrl,
  };
  if (metadata) {
    body.metadata = metadata;
  }

  const result = await composioRequest('POST', '/connectedAccounts', body);

  // Fix 10: Standardize on connectedAccountId
  const connectedAccountId = result.id || result.connectedAccountId || result.connectionId;
  const redirectUrl = result.redirectUrl || result.url;

  // Fix 5: Validate initiateConnection response
  if (!connectedAccountId) {
    throw new Error('Composio API returned no connection ID');
  }
  if (!redirectUrl) {
    throw new Error('Composio API returned no redirect URL');
  }

  return { connectedAccountId, redirectUrl };
}

/**
 * Get the status and details of a connection
 * @param connectedAccountId - The connected account ID to check
 */
export async function getConnectionStatus(
  connectedAccountId: string
): Promise<{
  id: string;
  status: string;
  appName: string;
  metadata?: Record<string, any>;
}> {
  const result = await composioRequest('GET', `/connectedAccounts/${connectedAccountId}`);
  return {
    id: result.id,
    status: result.status,
    appName: result.appName,
    metadata: result.metadata,
  };
}

/**
 * Delete/disconnect a connected account
 * @param connectedAccountId - The connected account ID to delete
 */
export async function deleteConnection(connectedAccountId: string): Promise<void> {
  await composioRequest('DELETE', `/connectedAccounts/${connectedAccountId}`);
}
