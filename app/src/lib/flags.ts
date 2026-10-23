/** The platform console has no sign-in until roadmap item now-03. Keep it off everywhere except local development. */
export function devPlatformEnabled(): boolean {
  return process.env.ENABLE_DEV_PLATFORM === "true" && process.env.NODE_ENV !== "production";
}
