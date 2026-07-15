import { randomUUID } from "node:crypto";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error Node's strip-only runner requires the explicit .ts extension.
import { createDeveloperPasswordHash, generateDeveloperPassword, validateDeveloperPassword } from "../lib/developer-credentials.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Explicit process environment remains supported for CI and isolated tests.
}

type Action = "bootstrap" | "rotate" | "status";

type CliOptions = {
  action: Action;
  projectRef: string;
  yes: boolean;
  passwordStdin: boolean;
  noShowPassword: boolean;
  testLocal: boolean;
};

type DeveloperCredentialRow = {
  password_version: number;
  credential_version: string;
  must_rotate: boolean;
};

function fail(message: string): never {
  process.stderr.write(`Developer credential command failed: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const [actionValue, ...rest] = argv;
  if (!(["bootstrap", "rotate", "status"] as string[]).includes(actionValue || "")) {
    fail("expected bootstrap, rotate, or status.");
  }

  let projectRef = "";
  let yes = false;
  let passwordStdin = false;
  let noShowPassword = false;
  let testLocal = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--project-ref") {
      projectRef = String(rest[index + 1] || "").trim();
      index += 1;
    } else if (argument === "--yes") {
      yes = true;
    } else if (argument === "--password-stdin") {
      passwordStdin = true;
    } else if (argument === "--no-show-password") {
      noShowPassword = true;
    } else if (argument === "--test-local") {
      testLocal = true;
    } else {
      fail(`unsupported argument: ${argument}. Passwords are never accepted as command-line arguments.`);
    }
  }

  if (!projectRef || !/^[A-Za-z0-9_-]{3,80}$/.test(projectRef)) {
    fail("--project-ref is required and must identify the target project.");
  }
  if (passwordStdin && !yes) {
    fail("--password-stdin requires --yes after separately verifying the target project ref.");
  }
  if (noShowPassword && !passwordStdin) {
    fail("--no-show-password is only valid with --password-stdin; generated passwords must be shown once.");
  }

  return {
    action: actionValue as Action,
    projectRef,
    yes,
    passwordStdin,
    noShowPassword,
    testLocal,
  };
}

function targetFromEnvironment(options: CliOptions) {
  const urlValue = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!urlValue || !serviceKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the maintainer's local environment.");
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL is invalid.");
  }

  const hostedMatch = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (hostedMatch && hostedMatch[1] !== options.projectRef) {
    fail(`project ref mismatch: URL points to ${hostedMatch[1]}, not ${options.projectRef}.`);
  }
  if (!hostedMatch && !options.testLocal) {
    fail("non-hosted Supabase URLs are refused unless --test-local is used by isolated automated tests.");
  }
  if (options.testLocal && !/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) {
    fail("--test-local is only accepted for localhost.");
  }

  return { url: url.toString().replace(/\/$/, ""), serviceKey };
}

async function confirmTarget(options: CliOptions) {
  process.stdout.write(`Target Supabase project ref: ${options.projectRef}\n`);
  if (options.yes || options.action === "status") return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const confirmation = await prompt.question(`Type ${options.projectRef} to confirm: `);
    if (confirmation.trim() !== options.projectRef) fail("target project confirmation did not match.");
  } finally {
    prompt.close();
  }
}

async function passwordForCommand(options: CliOptions) {
  if (!options.passwordStdin) return { password: generateDeveloperPassword(), generated: true };
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  const password = input.replace(/\r?\n$/, "");
  validateDeveloperPassword(password);
  return { password, generated: false };
}

function publicDatabaseError(error: { message?: string } | null) {
  const message = String(error?.message || "");
  if (message.includes("DEV_CREDENTIAL_ALREADY_INITIALIZED")) return "credential already initialized; use rotate instead.";
  if (message.includes("DEV_CREDENTIAL_UNINITIALIZED")) return "credential uninitialized; use bootstrap instead.";
  if (message.includes("DEV_CREDENTIAL_CONFLICT")) return "credential changed concurrently; check status and retry deliberately.";
  if (message.includes("DEV_CREDENTIAL_INVALID")) return "credential validation failed.";
  return "database operation failed; no password or internal database details were printed.";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = targetFromEnvironment(options);
  await confirmTarget(options);
  const supabase = createClient(target.url, target.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: statusError } = await supabase
    .from("developer_access")
    .select("password_version, credential_version, must_rotate")
    .eq("id", 1)
    .maybeSingle();
  if (statusError) fail("unable to read developer credential status. Confirm the latest migration and service key.");

  if (options.action === "status") {
    process.stdout.write(`Initialized: ${Boolean(existing)}\n`);
    process.stdout.write(`Must rotate: ${existing?.must_rotate === true}\n`);
    return;
  }

  const passwordResult = await passwordForCommand(options);
  const passwordHash = createDeveloperPasswordHash(passwordResult.password);
  const credentialVersion = randomUUID();

  if (options.action === "bootstrap") {
    if (existing) fail("credential already initialized; bootstrap never overwrites an existing customer credential.");
    const { error } = await supabase.rpc("developer_credential_bootstrap_rpc", {
      p_password_hash: passwordHash,
      p_credential_version: credentialVersion,
    });
    if (error) fail(publicDatabaseError(error));
    process.stdout.write("Developer credential initialized successfully.\n");
  } else {
    if (!existing) fail("credential uninitialized; use bootstrap instead.");
    const current = existing as DeveloperCredentialRow;
    const { error } = await supabase.rpc("developer_credential_rotate_rpc", {
      p_password_hash: passwordHash,
      p_credential_version: credentialVersion,
      p_expected_credential_version: current.credential_version,
    });
    if (error) fail(publicDatabaseError(error));
    process.stdout.write("Developer credential rotated successfully. All earlier developer cookies are now invalid.\n");
  }

  if (passwordResult.generated) {
    process.stdout.write("Developer password (shown once):\n");
    process.stdout.write(`${passwordResult.password}\n`);
  } else {
    process.stdout.write("The stdin password was not echoed.\n");
  }
  process.stdout.write("Save the password in the maintainer's password manager now; it cannot be recovered from Supabase.\n");
}

main().catch((error) => {
  if (error instanceof Error && error.name === "DeveloperPasswordPolicyError") fail(error.message);
  fail("unexpected failure; no credential material was printed.");
});
