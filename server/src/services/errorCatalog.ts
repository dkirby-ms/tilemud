import {
  ErrorCatalogEntry,
  ErrorCodeKey,
  ErrorCodeRegistry,
  ErrorDefinition,
  ErrorReason,
  mapDefinitionToEntry
} from "@@/models/errorCodes.js";

export interface ErrorCatalogServiceOptions {
  /** Optional predicate for filtering catalog entries (e.g. feature flags). */
  filter?: (definition: ErrorDefinition) => boolean;
}

function sortEntries(entries: ErrorCatalogEntry[]): ErrorCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const aCode = Number.parseInt(a.numericCode.slice(1), 10);
    const bCode = Number.parseInt(b.numericCode.slice(1), 10);
    return aCode - bCode;
  });
}

export class ErrorCatalogService {
  private readonly filter?: (definition: ErrorDefinition) => boolean;

  constructor(options: ErrorCatalogServiceOptions = {}) {
    this.filter = options.filter;
  }

  listCatalog(): ErrorCatalogEntry[] {
    const definitions = ErrorCodeRegistry.listDefinitions();
    const filtered = this.filter ? definitions.filter(this.filter) : definitions;
    return sortEntries(filtered.map(mapDefinitionToEntry));
  }

  getByNumericCode(numericCode: string): ErrorCatalogEntry | undefined {
    const definition = ErrorCodeRegistry.getDefinitionByNumericCode(numericCode);
    if (!definition) {
      return undefined;
    }
    if (this.filter && !this.filter(definition)) {
      return undefined;
    }
    return mapDefinitionToEntry(definition);
  }

  getByReason(reason: ErrorReason): ErrorCatalogEntry | undefined {
    const definition = ErrorCodeRegistry.getDefinitionByReason(reason);
    if (!definition) {
      return undefined;
    }
    if (this.filter && !this.filter(definition)) {
      return undefined;
    }
    return mapDefinitionToEntry(definition);
  }

  getByKey(key: ErrorCodeKey): ErrorCatalogEntry {
    const definition = ErrorCodeRegistry.getDefinitionByKey(key);
    if (this.filter && !this.filter(definition)) {
      throw new Error(`Error code ${key} is not available in this catalog instance`);
    }
    return mapDefinitionToEntry(definition);
  }
}
