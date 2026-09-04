/* eslint-disable no-console */
// Local-only UI harness. Never reads .env.local and never contacts a real database.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const appPort = 3026;
const probe = createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(appPort, "127.0.0.1", resolve); });
await new Promise(resolve => probe.close(resolve));
let rejectedWrites = 0;
const fixture = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "GET" && request.method !== "HEAD") {
    rejectedWrites += 1;
    response.writeHead(405); response.end('{"error":"UI fixture is read-only"}'); return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  const body = path === "/rest/v1/business_settings"
    ? { id:"00000000-0000-4000-8000-000000000001", business_name:"Navigation Test Boutique",address:"Test Street",phone:"",online_store_enabled:false }
    : [];
  response.end(JSON.stringify(body));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${fixture.address().port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY:"local-ui-fixture", SUPABASE_SERVICE_ROLE_KEY:"local-ui-fixture", NEXT_TELEMETRY_DISABLED:"1", BASE_URL:`http://127.0.0.1:${appPort}` };
env.ADMIN_UI_TEST_ISOLATED = "1";
for (const key of ["ADMIN_PASSWORD", "ADMIN_STAFF_PASSWORD", "ADMIN_INVENTORY_PASSWORD", "ADMIN_READONLY_PASSWORD", "AUTH_RATE_LIMIT_SECRET"]) env[key] = `A7${randomBytes(32).toString("hex")}`;
const app = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-p", String(appPort)], { env, stdio:"ignore", windowsHide:true });
try {
  let ready = false;
  for (let attempt=0; attempt<90; attempt++) {
    if (app.exitCode !== null) throw new Error("Isolated UI server failed to start.");
    try { const response = await fetch(`${env.BASE_URL}/admin`, {signal:AbortSignal.timeout(2000)}); if (response.ok) { ready=true; break; } } catch { /* compilation still running */ }
    await delay(500);
  }
  if (!ready) throw new Error("Isolated UI server did not become ready.");
  for (const file of ["scripts/admin-navigation-browser-test.mjs", "scripts/operations-browser-test.mjs"]) {
    const child = spawn(process.execPath, [file], {env,stdio:"inherit",windowsHide:true});
    const code = await new Promise((resolve,reject) => { child.once("error",reject); child.once("exit",resolve); });
    if (code !== 0) throw new Error(`${file} failed with exit ${code}`);
  }
  if (rejectedWrites) throw new Error(`Unexpected database write attempts: ${rejectedWrites}`);
  console.log("PASS local UI fixture: no database writes; no real credentials or customer services used.");
} finally {
  if (process.platform === "win32") {
    // Target only the child process tree created above, not unrelated dev servers.
    const stop = spawn("taskkill", ["/PID", String(app.pid), "/T", "/F"], {stdio:"ignore",windowsHide:true});
    await new Promise(resolve => stop.once("exit",resolve));
  } else app.kill("SIGTERM");
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
}
