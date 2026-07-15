import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/run-powershell.mjs <script.ps1>");
  process.exit(2);
}

const executable = process.platform === "win32" ? "powershell.exe" : "pwsh";
const args = ["-NoProfile"];
if (process.platform === "win32") args.push("-ExecutionPolicy", "Bypass");
args.push("-File", path.resolve(script), ...process.argv.slice(3));

const result = spawnSync(executable, args, { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(`Failed to start ${executable}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
