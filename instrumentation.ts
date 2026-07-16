export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Emergency role passwords are optional, but any configured value must be
    // strong and unique before the server starts accepting requests.
    const { validateAdminPasswordEnvironment } = await import("./lib/admin-password-security");
    validateAdminPasswordEnvironment(process.env);
  }
}
