import { ErrorCodeRegistry, mapDefinitionToEntry } from "@@/models/errorCodes.js";
function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        const aCode = Number.parseInt(a.numericCode.slice(1), 10);
        const bCode = Number.parseInt(b.numericCode.slice(1), 10);
        return aCode - bCode;
    });
}
export class ErrorCatalogService {
    filter;
    constructor(options = {}) {
        this.filter = options.filter;
    }
    listCatalog() {
        const definitions = ErrorCodeRegistry.listDefinitions();
        const filtered = this.filter ? definitions.filter(this.filter) : definitions;
        return sortEntries(filtered.map(mapDefinitionToEntry));
    }
    getByNumericCode(numericCode) {
        const definition = ErrorCodeRegistry.getDefinitionByNumericCode(numericCode);
        if (!definition) {
            return undefined;
        }
        if (this.filter && !this.filter(definition)) {
            return undefined;
        }
        return mapDefinitionToEntry(definition);
    }
    getByReason(reason) {
        const definition = ErrorCodeRegistry.getDefinitionByReason(reason);
        if (!definition) {
            return undefined;
        }
        if (this.filter && !this.filter(definition)) {
            return undefined;
        }
        return mapDefinitionToEntry(definition);
    }
    getByKey(key) {
        const definition = ErrorCodeRegistry.getDefinitionByKey(key);
        if (this.filter && !this.filter(definition)) {
            throw new Error(`Error code ${key} is not available in this catalog instance`);
        }
        return mapDefinitionToEntry(definition);
    }
}
//# sourceMappingURL=errorCatalog.js.map