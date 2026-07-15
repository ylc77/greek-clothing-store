import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = process.cwd();
const roots = [
  "app",
  "components",
  "docs",
  "lib",
  "scripts",
  "supabase/migrations",
  "tests",
  ".next/static",
];
const individualFiles = ["README.md", "agents.md", ".env.example", "package.json", "supabase/client-init.sql"];
const textExtensions = new Set([".css", ".example", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx"]);
const findings = [];

function collect(path) {
  if (!existsSync(path)) return [];
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? collect(child) : [child];
  });
}

function localServiceRoleCandidates() {
  const candidates = new Set();
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) candidates.add(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const result = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"], { cwd: ROOT, encoding: "utf8" })
    : spawnSync("npx", ["supabase", "status", "-o", "env"], { cwd: ROOT, encoding: "utf8" });
  if (result.status === 0) {
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const match = line.match(/^SERVICE_ROLE_KEY="(.+)"$/);
      if (match) candidates.add(match[1]);
    }
  }
  return [...candidates].filter((value) => value.length >= 20);
}

const serviceRoleCandidates = localServiceRoleCandidates();
const staticChecks = [
  {
    label: "embedded reusable scrypt credential",
    pattern: /scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]{86}==/g,
  },
  {
    label: "embedded Supabase secret key",
    pattern: /sb_secret_[A-Za-z0-9_-]{16,}/g,
  },
  {
    label: "developer plaintext constant",
    pattern: /(?:DEVELOPER_PASSWORD|developerPassword)\s*[:=]\s*["'][^"'\r\n]{8,}["']/g,
  },
  {
    label: "assigned service role value",
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!$|your-|<|\{)[^\s#]{20,}/g,
  },
];

const files = [
  ...roots.flatMap((path) => collect(resolve(ROOT, path))),
  ...individualFiles.map((path) => resolve(ROOT, path)).filter(existsSync),
].filter((path, index, all) => all.indexOf(path) === index)
  .filter((path) => textExtensions.has(extname(path)) || path.endsWith(".env.example"));

for (const path of files) {
  const content = readFileSync(path, "utf8");
  for (const check of staticChecks) {
    check.pattern.lastIndex = 0;
    if (check.pattern.test(content)) findings.push({ path, label: check.label });
  }
  for (const candidate of serviceRoleCandidates) {
    if (content.includes(candidate)) findings.push({ path, label: "local service role material" });
  }
}

if (!existsSync(resolve(ROOT, ".next/static"))) {
  findings.push({ path: resolve(ROOT, ".next/static"), label: "browser bundle missing; run npm run build before the final scan" });
}

if (findings.length > 0) {
  process.stderr.write("Developer secret scan failed:\n");
  for (const finding of findings) {
    process.stderr.write(`- ${relative(ROOT, finding.path)}: ${finding.label}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Developer secret scan passed across ${files.length} source, migration, documentation, test, snapshot, and browser bundle files.\n`);
}
