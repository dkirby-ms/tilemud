const DEFAULT_BUILD_VERSION = "0.0.0-dev";

/**
 * Returns the build identifier that both server and web client must share.
 * Falls back to a dev-friendly default when no explicit version is supplied.
 */
export function getServerBuildVersion(): string {
  const raw = process.env.SERVER_BUILD_VERSION;
  const trimmed = raw?.trim();

  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  return DEFAULT_BUILD_VERSION;
}

export const SERVER_BUILD_VERSION = getServerBuildVersion();
