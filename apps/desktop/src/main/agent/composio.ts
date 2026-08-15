import type { AppConfig } from "@aether/shared";

import { resolveComposioKey } from "../secrets.js";

/**
 * Composio integration is loaded lazily and defensively: the SDK surface can
 * change, and the app must keep working (conversationally) even if tools are
 * unavailable. Everything here is best-effort and typed loosely on purpose.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

let composioClient: AnyRecord | null = null;

async function getClient(): Promise<AnyRecord | null> {
  const apiKey = resolveComposioKey();
  if (!apiKey) return null;
  if (composioClient) return composioClient;
  try {
    const mod = (await import("@composio/core")) as AnyRecord;
    const Composio = mod.Composio ?? mod.default;
    composioClient = new Composio({ apiKey });
    return composioClient;
  } catch (err) {
    console.error("[composio] failed to initialize SDK:", err);
    return null;
  }
}

export async function isComposioAvailable(): Promise<boolean> {
  return (await getClient()) !== null;
}

/**
 * Returns Vercel AI SDK compatible tool definitions for the enabled toolkits.
 * Uses the `ai` package `jsonSchema` helper to avoid JSON-schema -> zod work.
 */
export async function getComposioTools(config: AppConfig): Promise<AnyRecord> {
  const client = await getClient();
  if (!client || config.integrations.enabledToolkits.length === 0) return {};
  const { jsonSchema, tool } = (await import("ai")) as AnyRecord;
  const userId = config.integrations.userId;

  let rawTools: AnyRecord[] = [];
  try {
    // Preferred documented shape: composio.tools.get(userId, { toolkits })
    const result = await client.tools.get(userId, {
      toolkits: config.integrations.enabledToolkits,
      limit: 30,
    });
    rawTools = Array.isArray(result) ? result : (result?.items ?? result?.tools ?? []);
  } catch (err) {
    console.error("[composio] tools.get failed:", err);
    return {};
  }

  const tools: AnyRecord = {};
  for (const raw of rawTools) {
    const slug: string | undefined = raw.slug ?? raw.name ?? raw.function?.name;
    if (!slug) continue;
    const description: string = raw.description ?? raw.function?.description ?? slug;
    const parameters = raw.inputParameters ?? raw.parameters ?? raw.function?.parameters ?? { type: "object", properties: {} };
    tools[slug] = tool({
      description,
      parameters: jsonSchema(parameters),
      execute: async (args: AnyRecord) => {
        try {
          const res = await client.tools.execute(slug, {
            userId,
            arguments: args,
            dangerouslySkipVersionCheck: true,
          });
          return res?.data ?? res;
        } catch (err) {
          return { error: `Tool ${slug} failed: ${String(err)}` };
        }
      },
    });
  }
  return tools;
}

/** Starts an OAuth connection for a toolkit; returns a redirect URL to open. */
export async function connectToolkit(
  config: AppConfig,
  toolkit: string,
): Promise<{ redirectUrl: string } | { error: string }> {
  const client = await getClient();
  if (!client) return { error: "Composio is not configured. Save a Composio API key in Settings." };
  const userId = config.integrations.userId;
  try {
    // Current SDK path: connected_accounts.link(userId, toolkit)
    if (client.connectedAccounts?.link) {
      const req = await client.connectedAccounts.link(userId, toolkit);
      const url = req?.redirectUrl ?? req?.redirect_url;
      if (url) return { redirectUrl: url };
    }
    // Session-based fallback: session.authorize(toolkit)
    if (client.create) {
      const session = await client.create(userId);
      const req = await session.authorize(toolkit);
      const url = req?.redirectUrl ?? req?.redirect_url;
      if (url) return { redirectUrl: url };
    }
    return { error: "Could not obtain a connection URL from Composio." };
  } catch (err) {
    return { error: `Composio connect failed: ${String(err)}` };
  }
}

/** Lists popular toolkit slugs the user can connect. Static list keeps UI usable offline. */
export function popularToolkits(): string[] {
  return ["gmail", "googlecalendar", "github", "slack", "notion"];
}

export async function listIntegrationStatus(config: AppConfig): Promise<
  import("@aether/shared").IntegrationToolkitStatus[]
> {
  const slugs = popularToolkits();
  const enabled = new Set(config.integrations.enabledToolkits);
  const client = await getClient();
  const connected = new Map<string, string>();

  if (client) {
    try {
      const accounts =
        (await client.connectedAccounts?.list?.({ userId: config.integrations.userId })) ??
        (await client.connectedAccounts?.get?.({ userIds: [config.integrations.userId] })) ??
        [];
      const items = Array.isArray(accounts) ? accounts : (accounts?.items ?? accounts?.data ?? []);
      for (const acct of items) {
        const toolkit: string | undefined =
          acct.appUniqueId ?? acct.toolkitSlug ?? acct.toolkit ?? acct.appName ?? acct.appUniqueName;
        if (!toolkit) continue;
        const label: string =
          acct.accountLabel ?? acct.email ?? acct.status ?? acct.id ?? "connected";
        connected.set(String(toolkit).toLowerCase(), String(label));
      }
    } catch (err) {
      console.error("[composio] list connected accounts failed:", err);
      return slugs.map((slug) => ({
        slug,
        enabled: enabled.has(slug),
        connected: false,
        lastError: client ? `Could not refresh status: ${String(err)}` : undefined,
      }));
    }
  }

  return slugs.map((slug) => {
    const label = connected.get(slug.toLowerCase());
    return {
      slug,
      enabled: enabled.has(slug),
      connected: Boolean(label),
      accountLabel: label,
      lastError: !client ? "Composio key not configured" : undefined,
    };
  });
}
