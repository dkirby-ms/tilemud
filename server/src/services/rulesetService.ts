import type {
  CreateRuleSetData,
  RuleSetRepository,
  RuleSetVersion
} from "@@/models/rulesetRepository.js";

export interface InitialTilePlacement {
  x: number;
  y: number;
  tileType: number;
}

export type RuleSetAdjacency = "none" | "orthogonal" | "any";

export interface RuleSetPlacementRules {
  adjacency: RuleSetAdjacency;
  allowFirstPlacementAnywhere: boolean;
}

export interface RuleSetBoardConfig {
  width: number;
  height: number;
  initialTiles: InitialTilePlacement[];
}

export interface RuleSetMetadata {
  description?: string;
  tags: string[];
  maxPlayers: number;
  board: RuleSetBoardConfig;
  placement: RuleSetPlacementRules;
  extras: Record<string, unknown>;
}

export interface SerializedRuleSet {
  id: string;
  version: string;
  createdAt: string;
  metadata: RuleSetMetadata;
}

export interface RuleSetDetail {
  id: string;
  version: string;
  createdAt: Date;
  metadata: RuleSetMetadata;
}

export interface PublishRuleSetInput {
  version: string;
  metadata?: unknown;
}

export interface RuleSetListOptions {
  limit?: number;
  offset?: number;
}

export class RuleSetNotFoundError extends Error {
  constructor(public readonly lookup: { type: "id" | "version"; value: string }) {
    super(`Rule set not found for ${lookup.type} ${lookup.value}`);
    this.name = "RuleSetNotFoundError";
  }
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const DEFAULT_BOARD_WIDTH = 16;
const DEFAULT_BOARD_HEIGHT = 16;
const MAX_BOARD_DIMENSION = 256;
const DEFAULT_MAX_PLAYERS = 32;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 64;
const DEFAULT_ADJACENCY: RuleSetAdjacency = "orthogonal";
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 32;
const LIST_MAX_LIMIT = 200;

export class RuleSetService {
  private readonly repository: RuleSetRepository;

  constructor(dependencies: { repository: RuleSetRepository }) {
    this.repository = dependencies.repository;
  }

  async publishRuleSet(input: PublishRuleSetInput): Promise<RuleSetDetail> {
    validateSemanticVersion(input.version);

    const existing = await this.repository.findByVersion(input.version);
    if (existing) {
      throw new Error(`Rule set version ${input.version} already exists.`);
    }

    const normalized = normalizeRuleSetMetadata(input.metadata);
    const created = await this.repository.create({
      version: input.version,
      metadataJson: toSerializableMetadata(normalized)
    });

    return this.mapRuleSet(created);
  }

  async getRuleSetById(id: string): Promise<RuleSetDetail | null> {
    const found = await this.repository.findById(id);
    return found ? this.mapRuleSet(found) : null;
  }

  async requireRuleSetById(id: string): Promise<RuleSetDetail> {
    const found = await this.getRuleSetById(id);
    if (!found) {
      throw new RuleSetNotFoundError({ type: "id", value: id });
    }
    return found;
  }

  async getRuleSetByVersion(version: string): Promise<RuleSetDetail | null> {
    const found = await this.repository.findByVersion(version);
    return found ? this.mapRuleSet(found) : null;
  }

  async requireRuleSetByVersion(version: string): Promise<RuleSetDetail> {
    const found = await this.getRuleSetByVersion(version);
    if (!found) {
      throw new RuleSetNotFoundError({ type: "version", value: version });
    }
    return found;
  }

  async getLatestRuleSet(): Promise<RuleSetDetail | null> {
    const latest = await this.repository.findLatestVersion();
    return latest ? this.mapRuleSet(latest) : null;
  }

  async listRuleSets(options: RuleSetListOptions = {}): Promise<RuleSetDetail[]> {
    const limit = clampInteger(options.limit, 1, LIST_MAX_LIMIT) ?? 100;
    const offset = clampInteger(options.offset, 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const entries = await this.repository.listAll(limit, offset);
    return entries.map((entry) => this.mapRuleSet(entry));
  }

  async listVersions(): Promise<string[]> {
    return this.repository.listVersions();
  }

  serialize(ruleSet: RuleSetDetail): SerializedRuleSet {
    return {
      id: ruleSet.id,
      version: ruleSet.version,
      createdAt: ruleSet.createdAt.toISOString(),
      metadata: cloneMetadata(ruleSet.metadata)
    };
  }

  serializeMany(ruleSets: RuleSetDetail[]): SerializedRuleSet[] {
    return ruleSets.map((ruleSet) => this.serialize(ruleSet));
  }

  private mapRuleSet(entity: RuleSetVersion): RuleSetDetail {
    return {
      id: entity.id,
      version: entity.version,
      createdAt: entity.createdAt,
      metadata: normalizeRuleSetMetadata(entity.metadataJson)
    };
  }
}

function validateSemanticVersion(version: string): void {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Version ${version} is not a valid semantic version (MAJOR.MINOR.PATCH).`);
  }
}

function clampInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const int = Math.trunc(value);
  if (int < min) {
    return min;
  }
  if (int > max) {
    return max;
  }
  return int;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampBoardDimension(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const int = Math.trunc(parsed);
  if (int < 1) {
    return 1;
  }
  if (int > MAX_BOARD_DIMENSION) {
    return MAX_BOARD_DIMENSION;
  }
  return int;
}

function sanitizeInitialTiles(raw: unknown, width: number, height: number): InitialTilePlacement[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const placements: InitialTilePlacement[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const xRaw = typeof entry.x === "number" ? entry.x : Number(entry.x);
    const yRaw = typeof entry.y === "number" ? entry.y : Number(entry.y);
    const tileTypeRaw = typeof entry.tileType === "number" ? entry.tileType : Number(entry.tileType);

    if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw) || !Number.isFinite(tileTypeRaw)) {
      continue;
    }

    const x = Math.trunc(xRaw);
    const y = Math.trunc(yRaw);
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    placements.push({ x, y, tileType: Math.trunc(tileTypeRaw) });
  }

  return placements;
}

function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(trimmed);
    if (tags.length >= MAX_TAGS) {
      break;
    }
  }

  return tags;
}

function sanitizePlacement(raw: unknown): RuleSetPlacementRules {
  const source = isRecord(raw)
    ? raw
    : undefined;
  const adjacencyRaw = typeof source?.adjacency === "string"
    ? source.adjacency
    : typeof source?.type === "string"
      ? source.type
      : undefined;
  const normalizedAdjacency = normalizeAdjacency(adjacencyRaw);
  const allowFirst = typeof source?.allowFirstPlacementAnywhere === "boolean"
    ? source.allowFirstPlacementAnywhere
    : true;
  return {
    adjacency: normalizedAdjacency,
    allowFirstPlacementAnywhere: allowFirst
  };
}

function normalizeAdjacency(value: string | undefined): RuleSetAdjacency {
  if (!value) {
    return DEFAULT_ADJACENCY;
  }
  const normalized = value.toLowerCase();
  if (normalized === "none" || normalized === "orthogonal" || normalized === "any") {
    return normalized;
  }
  return DEFAULT_ADJACENCY;
}

function sanitizeExtras(record: Record<string, unknown>, recognizedKeys: Set<string>): Record<string, unknown> {
  const extraEntries: Record<string, unknown> = {};

  const mergeExtras = (source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (recognizedKeys.has(key)) {
        continue;
      }
      const sanitizedValue = sanitizeJsonValue(value);
      if (sanitizedValue !== undefined) {
        extraEntries[key] = sanitizedValue;
      }
    }
  };

  if (isRecord(record.extras)) {
    mergeExtras(record.extras);
  }

  mergeExtras(record);

  return extraEntries;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function normalizeRuleSetMetadata(metadata: unknown): RuleSetMetadata {
  const record = isRecord(metadata) ? metadata : {};

  const boardRecord = isRecord(record.board) ? record.board : {};
  const width = clampBoardDimension(boardRecord.width, DEFAULT_BOARD_WIDTH);
  const height = clampBoardDimension(boardRecord.height, DEFAULT_BOARD_HEIGHT);
  const initialTiles = sanitizeInitialTiles(boardRecord.initialTiles, width, height);

  const placementSource = isRecord(record.placementRules)
    ? record.placementRules
    : isRecord(record.placement)
      ? record.placement
      : undefined;
  const placement = sanitizePlacement(placementSource);

  const tags = sanitizeTags(record.tags);

  const maxPlayersParsed = clampInteger(record.maxPlayers, MIN_MAX_PLAYERS, MAX_MAX_PLAYERS);
  const maxPlayers = maxPlayersParsed ?? DEFAULT_MAX_PLAYERS;

  const description = typeof record.description === "string" ? record.description.trim() : undefined;
  const recognizedKeys = new Set([
    "board",
    "placement",
    "placementRules",
    "tags",
    "description",
    "maxPlayers",
    "extras"
  ]);
  const extras = sanitizeExtras(record, recognizedKeys);

  const metadataResult: RuleSetMetadata = {
    description: description && description.length > 0 ? description : undefined,
    tags,
    maxPlayers,
    board: {
      width,
      height,
      initialTiles
    },
    placement,
    extras
  };

  return metadataResult;
}

function toSerializableMetadata(metadata: RuleSetMetadata): Record<string, unknown> {
  const serializable: Record<string, unknown> = {
    board: {
      width: metadata.board.width,
      height: metadata.board.height,
      initialTiles: metadata.board.initialTiles.map((tile) => ({ ...tile }))
    },
    placement: { ...metadata.placement },
    maxPlayers: metadata.maxPlayers,
    tags: [...metadata.tags]
  };

  if (metadata.description) {
    serializable.description = metadata.description;
  }

  if (Object.keys(metadata.extras).length > 0) {
    serializable.extras = sanitizeJsonValue(metadata.extras);
  }

  return serializable;
}

function cloneMetadata(metadata: RuleSetMetadata): RuleSetMetadata {
  return {
    description: metadata.description,
    tags: [...metadata.tags],
    maxPlayers: metadata.maxPlayers,
    board: {
      width: metadata.board.width,
      height: metadata.board.height,
      initialTiles: metadata.board.initialTiles.map((tile) => ({ ...tile }))
    },
    placement: { ...metadata.placement },
    extras: sanitizeJsonValue(metadata.extras) as Record<string, unknown>
  };
}

export function createRuleSetService(repository: RuleSetRepository): RuleSetService {
  return new RuleSetService({ repository });
}
