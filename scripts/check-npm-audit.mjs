import fs from "node:fs";
import process from "node:process";

const reportPath = process.argv[2];
if (!reportPath || !fs.existsSync(reportPath)) {
  console.error("npm audit JSON report is required.");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
} catch {
  console.error("npm audit did not produce valid JSON.");
  process.exit(2);
}

const vulnerabilities = report?.metadata?.vulnerabilities;
if (!vulnerabilities || typeof vulnerabilities !== "object") {
  console.error("npm audit report is missing vulnerability metadata.");
  process.exit(2);
}

const counts = Object.fromEntries(
  ["info", "low", "moderate", "high", "critical", "total"].map((severity) => [
    severity,
    Number(vulnerabilities[severity] || 0),
  ]),
);
const summary = `npm audit: ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low, ${counts.info} info.`;
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Dependency audit\n\n${summary}\n\nHigh or critical findings block this workflow. Moderate findings remain visible for review.\n`,
  );
}

if (counts.critical > 0 || counts.high > 0) process.exit(1);
