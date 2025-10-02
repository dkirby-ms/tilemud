export const CLIENT_BUILD_VERSION = import.meta.env.VITE_CLIENT_BUILD_VERSION ?? "0.0.0-dev";

/**
 * Placeholder function to pull the server version from bootstrap payloads.
 * Until contracts are wired, this returns the current client build version.
 */
export function getExpectedServerBuildVersion(): string {
  return CLIENT_BUILD_VERSION;
}
