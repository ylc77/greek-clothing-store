import nextEnvironment from "@next/env";
// @ts-expect-error Node's strip-only runner requires the explicit .ts extension.
import { getBoxNowConfig, safeBoxNowError, verifyBoxNowConnection } from "../lib/boxnow.ts";
// @ts-expect-error Node's strip-only runner requires the explicit .ts extension.
import { getVivaConfig, getVivaWebhookVerificationKey, safeVivaError, verifyVivaConnection } from "../lib/viva.ts";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(process.cwd());

type Provider = "viva" | "boxnow";

function selectedProviders(): Provider[] {
  const index = process.argv.indexOf("--provider");
  const value = index >= 0 ? String(process.argv[index + 1] || "") : "all";
  if (value === "viva" || value === "boxnow") return [value];
  if (value === "all") return ["viva", "boxnow"];
  throw new Error("Use --provider viva, --provider boxnow, or --provider all.");
}

function publicEndpoints() {
  const raw = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  let siteUrl = "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      siteUrl = parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // Report an invalid public URL without echoing the supplied value.
  }
  return {
    siteUrlConfigured: Boolean(siteUrl),
    vivaWebhookUrl: siteUrl ? `${siteUrl}/api/webhooks/viva` : null,
    checkoutSuccessUrl: siteUrl ? `${siteUrl}/checkout/success` : null,
    checkoutFailureUrl: siteUrl ? `${siteUrl}/checkout/failure` : null,
  };
}

function configurationStatus() {
  let vivaApiConfigured = false;
  let vivaWebhookConfigured = false;
  let boxNowApiConfigured = false;
  try { getVivaConfig(); vivaApiConfigured = true; } catch {}
  try { getVivaWebhookVerificationKey(); vivaWebhookConfigured = true; } catch {}
  try { getBoxNowConfig(); boxNowApiConfigured = true; } catch {}
  const widgetPartnerId = String(process.env.NEXT_PUBLIC_BOXNOW_PARTNER_ID || "").trim();
  return {
    ...publicEndpoints(),
    useOnlineOrderRpc: process.env.USE_ONLINE_ORDER_RPC === "true",
    cronSecretConfigured: String(process.env.CRON_SECRET || "").length >= 32,
    viva: {
      apiConfigured: vivaApiConfigured,
      webhookConfigured: vivaWebhookConfigured,
    },
    boxnow: {
      apiConfigured: boxNowApiConfigured,
      widgetConfigured: /^\d{1,20}$/.test(widgetPartnerId),
    },
  };
}

async function verify(providers: Provider[]) {
  const results: Record<string, { ok: boolean; code?: string }> = {};
  for (const provider of providers) {
    if (provider === "viva") {
      try {
        getVivaWebhookVerificationKey();
        await verifyVivaConnection();
        results.viva = { ok: true };
      } catch (error) {
        results.viva = { ok: false, code: safeVivaError(error).code };
      }
    } else {
      try {
        await verifyBoxNowConnection();
        if (!/^\d{1,20}$/.test(String(process.env.NEXT_PUBLIC_BOXNOW_PARTNER_ID || "").trim())) {
          results.boxnow = { ok: false, code: "BOXNOW_WIDGET_NOT_CONFIGURED" };
        } else {
          results.boxnow = { ok: true };
        }
      } catch (error) {
        results.boxnow = { ok: false, code: safeBoxNowError(error).code };
      }
    }
  }
  return results;
}

async function main() {
  const command = String(process.argv[2] || "status");
  if (command === "status") {
    console.log(JSON.stringify(configurationStatus(), null, 2));
    return;
  }
  if (command !== "verify") throw new Error("Use status or verify.");
  const providers = selectedProviders();
  const configuration = configurationStatus();
  const connections = await verify(providers);
  console.log(JSON.stringify({ configuration, connections }, null, 2));
  if (Object.values(connections).some(result => !result.ok)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Commerce provider check failed.");
  process.exitCode = 1;
});
