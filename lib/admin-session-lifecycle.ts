type SupabaseSessionLike = { access_token?: string } | null;

export type AdminTokenUpdate =
  | { kind: "set"; token: string }
  | { kind: "clear" }
  | { kind: "ignore" };

export function tokenUpdateForSupabaseAuthEvent(event: string, session: SupabaseSessionLike): AdminTokenUpdate {
  if (event === "SIGNED_OUT" || event === "USER_DELETED") return { kind: "clear" };
  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
    const token = typeof session?.access_token === "string" ? session.access_token.trim() : "";
    return token ? { kind: "set", token } : { kind: "clear" };
  }
  return { kind: "ignore" };
}
