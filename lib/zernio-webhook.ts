/**
 * Zernio webhook auto-registration.
 *
 * Zernflow must register its own `/api/webhooks/late` endpoint in Zernio so that
 * inbound events (DMs, comments) are delivered to the Inbox. Zernio exposes a
 * single webhook per profile/API key, so this is idempotent and operates at the
 * workspace level (the secret lives on `workspace_secrets.webhook_secret` since
 * migration 00019; before it was `workspaces.webhook_secret`).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { getWorkspaceSecrets, saveWorkspaceSecrets } from "./workspace-secrets";

/** Name used to identify Zernflow's webhook among a profile's webhooks. */
export const WEBHOOK_NAME = "Zernflow";

/** Events Zernflow needs delivered to its webhook. */
export type WebhookEvent = "message.received" | "comment.received";

export interface EnsureWebhookOptions {
  /** Public base URL of this Zernflow deployment (e.g. NEXT_PUBLIC_APP_URL). */
  appUrl: string;
  /** Workspace-level HMAC secret used to verify webhook signatures. */
  secret: string;
  /** Events to subscribe to (at least one). */
  events: WebhookEvent[];
}

export interface EnsureWebhookResult {
  action: "created" | "updated" | "unchanged";
}

/** Minimal shape of a Zernio webhook entry (subset of the SDK's Webhook type). */
interface ZernioWebhook {
  _id?: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
}

function webhookUrl(appUrl: string): string {
  // trim() guards against whitespace smuggled in via the env var — a trailing
  // newline in NEXT_PUBLIC_APP_URL once registered a webhook with a "\n" in
  // the URL, silently failing every delivery (#10).
  return `${appUrl.trim().replace(/\/$/, "")}/api/webhooks/late`;
}

/** Normalizes a URL to origin+pathname, dropping query string and trailing slash. */
function normalizePath(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return u.replace(/\?.*$/, "").replace(/\/$/, "");
  }
}

/** True when two webhook URLs share the same origin+path, ignoring query string. */
function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && normalizePath(a) === normalizePath(b);
}

/**
 * Ensures Zernflow's webhook is registered in Zernio and up to date.
 *
 * - No webhook found → create it.
 * - Found but URL differs or an event is missing → update it.
 * - Found and correct → no-op.
 *
 * Identifying "our" webhook: match by path (ignoring any query string, since a
 * webhook registered by hand may carry an SSO bypass token in the URL) or by
 * name. Never adopt anything else: Zernio allows up to 10 webhooks per account,
 * so an unmatched entry belongs to another integration the user owns and
 * rewriting it would silently break that integration.
 */
export async function ensureWebhookRegistered(
  zernio: Zernio,
  opts: EnsureWebhookOptions,
): Promise<EnsureWebhookResult> {
  const url = webhookUrl(opts.appUrl);

  const res = await zernio.webhooks.getWebhookSettings();
  const webhooks = (res?.data?.webhooks ?? []) as ZernioWebhook[];
  const mine = webhooks.find((w) => samePath(w.url, url) || w.name === WEBHOOK_NAME);

  if (!mine) {
    await zernio.webhooks.createWebhookSettings({
      body: { name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "created" };
  }

  const eventsOk = opts.events.every((e) => mine.events?.includes(e));
  // Zernio's GET returns the stored secret, so drift is detectable. Without
  // this check a secret rotated locally (e.g. the workspace column arriving
  // after the webhook was first registered) never reaches Zernio and every
  // delivery fails signature verification from then on.
  const secretOk = (mine.secret || "") === opts.secret;
  if (mine.url !== url || !eventsOk || !secretOk) {
    await zernio.webhooks.updateWebhookSettings({
      body: { _id: mine._id!, name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "updated" };
  }

  return { action: "unchanged" };
}

/** Generates a random 32-byte secret as a 64-char hex string. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Returns the workspace's webhook secret, generating and persisting one the first
 * time it is needed. The same secret is used both to register the webhook in Zernio
 * and to verify inbound signatures, so it must be stable per workspace.
 *
 * `supabase` must be the service-role client (workspace_secrets has no RLS
 * policies). Callers must validate the user's permissions first.
 */
export async function getOrCreateWorkspaceWebhookSecret(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { webhookSecret } = await getWorkspaceSecrets(workspaceId, supabase);
  if (webhookSecret) return webhookSecret;

  const secret = generateWebhookSecret();
  const { error } = await saveWorkspaceSecrets(workspaceId, { webhookSecret: secret }, supabase);
  if (error) throw new Error(error);
  return secret;
}

/**
 * Verifies an inbound webhook's HMAC-SHA256 signature (x-late-signature header)
 * against the shared secret using a constant-time comparison.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

/** Minimal channel shape needed to resolve the webhook secret. */
export interface ChannelSecretRef {
  workspace_id: string;
  webhook_secret?: string | null;
}

/**
 * Resolves the secret used to verify a webhook signature, preferring the
 * workspace-level secret and falling back to the legacy per-channel secret
 * during the transition. Returns null when neither is configured. Throws if the
 * secrets can't be read (the webhook then answers 500 and Zernio retries,
 * instead of accepting an unverified delivery). `supabase` must be the
 * service-role client.
 */
export async function resolveWebhookSecret(
  supabase: SupabaseClient,
  channel: ChannelSecretRef,
): Promise<string | null> {
  const { webhookSecret } = await getWorkspaceSecrets(channel.workspace_id, supabase);
  return webhookSecret || channel.webhook_secret || null;
}
