import { createHash, timingSafeEqual } from "node:crypto";

export type EmergencyAdminRole = "owner" | "staff" | "inventory" | "readonly";
export type AdminPasswordConfiguration = Partial<Record<EmergencyAdminRole, string>>;

const roleVariables: Array<[EmergencyAdminRole, string]> = [
  ["owner", "ADMIN_PASSWORD"],
  ["staff", "ADMIN_STAFF_PASSWORD"],
  ["inventory", "ADMIN_INVENTORY_PASSWORD"],
  ["readonly", "ADMIN_READONLY_PASSWORD"],
];

export class AdminPasswordConfigurationError extends Error {
  readonly code: "WEAK_PASSWORD" | "DUPLICATE_PASSWORD";

  constructor(code: "WEAK_PASSWORD" | "DUPLICATE_PASSWORD", message: string) {
    super(message);
    this.name = "AdminPasswordConfigurationError";
    this.code = code;
  }
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function timingSafePasswordMatch(provided: string, expected: string) {
  return timingSafeEqual(digest(provided), digest(expected));
}

function validateStrength(variable: string, value: string) {
  if (
    value.length < 20
    || value.trim() !== value
    || !/[a-z]/i.test(value)
    || !/\d/.test(value)
    || !/[^a-z0-9]/i.test(value)
    || /(change.?me|password|admin123|default|example|your.?password)/i.test(value)
  ) {
    throw new AdminPasswordConfigurationError(
      "WEAK_PASSWORD",
      `${variable} is configured but does not meet the emergency-password policy.`,
    );
  }
}

export function validateAdminPasswordEnvironment(env: Record<string, string | undefined>): AdminPasswordConfiguration {
  const configuration: AdminPasswordConfiguration = {};
  const seen = new Map<string, string>();
  for (const [role, variable] of roleVariables) {
    const value = typeof env[variable] === "string" ? env[variable]! : "";
    if (!value) continue;
    validateStrength(variable, value);
    const digestValue = digest(value).toString("hex");
    const previous = seen.get(digestValue);
    if (previous) {
      throw new AdminPasswordConfigurationError(
        "DUPLICATE_PASSWORD",
        `${variable} must not reuse the password configured for ${previous}.`,
      );
    }
    seen.set(digestValue, variable);
    configuration[role] = value;
  }
  return configuration;
}

export function configuredAdminPasswordRole(provided: string, configuration: AdminPasswordConfiguration): EmergencyAdminRole | null {
  if (!provided) return null;
  let matched: EmergencyAdminRole | null = null;
  for (const [role] of roleVariables) {
    const expected = configuration[role] || `missing-${role}-${"0".repeat(32)}`;
    if (timingSafePasswordMatch(provided, expected) && configuration[role]) matched = role;
  }
  return matched;
}
