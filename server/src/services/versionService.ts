import { SERVER_BUILD_VERSION } from "../infra/version.js";

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

type CompareResult = -1 | 0 | 1;

export interface VersionServiceOptions {
  currentVersion?: string;
  supportedVersions?: string[];
  protocol?: string;
  now?: () => Date;
}

export interface VersionInfo {
  version: string;
  protocol: string;
  updatedAt: string;
  supportedVersions: string[];
}

export type VersionCompatibilityReason =
  | "match"
  | "missing"
  | "mismatch"
  | "behind"
  | "ahead"
  | "invalid";

export interface VersionCompatibilityResult {
  isCompatible: boolean;
  reason: VersionCompatibilityReason;
  expectedVersion: string;
  receivedVersion: string | null;
  compareResult: CompareResult | null;
  message: string;
}

export class VersionService {
  private readonly currentVersion: string;
  private readonly supportedVersions: string[];
  private readonly protocol: string;
  private readonly now: () => Date;
  private readonly updatedAt: string;

  constructor(options: VersionServiceOptions = {}) {
    this.currentVersion = normalizeVersion(options.currentVersion) ?? SERVER_BUILD_VERSION;
    const supported = (options.supportedVersions ?? []).map((value) => normalizeVersion(value)).filter(Boolean) as string[];

    if (!supported.includes(this.currentVersion)) {
      supported.push(this.currentVersion);
    }

    this.supportedVersions = Array.from(new Set(supported));
    this.protocol = options.protocol ?? "colyseus";
    this.now = options.now ?? (() => new Date());
    this.updatedAt = this.now().toISOString();
  }

  getVersionInfo(): VersionInfo {
    return {
      version: this.currentVersion,
      protocol: this.protocol,
      updatedAt: this.updatedAt,
      supportedVersions: [...this.supportedVersions]
    } satisfies VersionInfo;
  }

  isCompatible(clientVersion: string | null | undefined): boolean {
    return this.checkCompatibility(clientVersion).isCompatible;
  }

  checkCompatibility(clientVersion: string | null | undefined): VersionCompatibilityResult {
    const normalized = normalizeVersion(clientVersion);

    if (!normalized) {
      return {
        isCompatible: false,
        reason: "missing",
        expectedVersion: this.currentVersion,
        receivedVersion: null,
        compareResult: null,
        message: "Client did not provide a protocol version."
      } satisfies VersionCompatibilityResult;
    }

    if (!isSemanticVersion(normalized)) {
      return {
        isCompatible: false,
        reason: "invalid",
        expectedVersion: this.currentVersion,
        receivedVersion: normalized,
        compareResult: null,
        message: "Client provided an invalid protocol version string."
      } satisfies VersionCompatibilityResult;
    }

    const compareResult = compareSemver(normalized, this.currentVersion);

    if (this.supportedVersions.includes(normalized)) {
      return {
        isCompatible: true,
        reason: compareResult === 0 ? "match" : compareResult < 0 ? "behind" : "ahead",
        expectedVersion: this.currentVersion,
        receivedVersion: normalized,
        compareResult,
        message:
          compareResult === 0
            ? "Client version matches server version."
            : compareResult < 0
              ? "Client is running an older but still supported version."
              : "Client is running a newer but supported version."
      } satisfies VersionCompatibilityResult;
    }

    const reason: VersionCompatibilityReason = compareResult === 0 ? "mismatch" : compareResult < 0 ? "behind" : "ahead";

    const message =
      reason === "behind"
        ? "Client version is behind server version; please update the client."
        : reason === "ahead"
          ? "Client version is ahead of server version; please update or align with the latest server build."
          : "Client version does not match supported versions; please update the client.";

    return {
      isCompatible: false,
      reason,
      expectedVersion: this.currentVersion,
      receivedVersion: normalized,
      compareResult,
      message
    } satisfies VersionCompatibilityResult;
  }
}

function normalizeVersion(version: string | null | undefined): string | null {
  if (!version) {
    return null;
  }
  const trimmed = version.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSemanticVersion(version: string): boolean {
  return SEMVER_REGEX.test(version);
}

function compareSemver(a: string, b: string): CompareResult {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  if (!parsedA || !parsedB) {
    return a === b ? 0 : a < b ? -1 : 1;
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major < parsedB.major ? -1 : 1;
  }

  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor < parsedB.minor ? -1 : 1;
  }

  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch < parsedB.patch ? -1 : 1;
  }

  const preA = parsedA.prerelease;
  const preB = parsedB.prerelease;

  if (preA === preB) {
    return 0;
  }

  if (preA === undefined) {
    return 1;
  }

  if (preB === undefined) {
    return -1;
  }

  return preA < preB ? -1 : preA > preB ? 1 : 0;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

function parseSemver(version: string): ParsedSemver | null {
  const match = version.match(SEMVER_REGEX);
  if (!match) {
    return null;
  }

  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? undefined,
    build: build ?? undefined
  } satisfies ParsedSemver;
}
