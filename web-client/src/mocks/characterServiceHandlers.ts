import { http, HttpResponse } from 'msw';
import type {
  ArchetypeCatalog,
  Player,
  Character,
  CreateCharacterRequest,
  ServiceHealth,
  ServiceOutage,
  Archetype,
} from '../types/domain';

// Helper to generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Mock data for character service responses
 */
const mockArchetypes: Archetype[] = [
  {
    id: 'warrior',
    name: 'Warrior',
    description: 'A fierce fighter skilled in close combat and protective tactics.',
    isAvailable: true,
    lastUpdatedAt: '2024-09-25T10:00:00Z',
  },
  {
    id: 'mage',
    name: 'Mage',
    description: 'A master of arcane arts and elemental magic.',
    isAvailable: true,
    lastUpdatedAt: '2024-09-25T10:00:00Z',
  },
  {
    id: 'rogue',
    name: 'Rogue',
    description: 'A stealthy operative skilled in deception and precision strikes.',
    isAvailable: true,
    lastUpdatedAt: '2024-09-25T10:00:00Z',
  },
  {
    id: 'paladin',
    name: 'Paladin',
    description: 'A holy warrior combining divine magic with martial prowess.',
    isAvailable: false, // Temporarily unavailable for balance testing
    lastUpdatedAt: '2024-09-25T10:00:00Z',
  },
  {
    id: 'wizard-001',
    name: 'Wizard',
    description: 'A master of arcane knowledge and powerful spells.',
    isAvailable: true,
    lastUpdatedAt: '2024-09-25T10:00:00Z',
  },
];

const mockCharacters: Character[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Theron',
    archetypeId: 'warrior',
    createdAt: '2024-09-20T14:30:00Z',
    status: 'active',
  },
  {
    id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    name: 'Lyralei',
    archetypeId: 'mage',
    createdAt: '2024-09-22T16:45:00Z',
    status: 'active',
  },
];

/**
 * Configuration flags for testing different service states
 */
let outageMode = false;
let catalogOutage = false;
let characterServiceOutage = false;
let healthServiceDegraded = false;

/**
 * Helper function to create consistent outage notices
 */
const createOutageNotice = (
  service: string,
  message: string,
  retryAfterSeconds?: number
): ServiceOutage => ({
  service,
  message,
  retryAfterSeconds: retryAfterSeconds ?? null,
});

/**
 * Mock configuration object for testing setup
 */
export const mockConfig = {
  enableOutageMode: () => { outageMode = true; },
  disableOutageMode: () => { outageMode = false; },
  enableCatalogOutage: () => { catalogOutage = true; },
  disableCatalogOutage: () => { catalogOutage = false; },
  enableCharacterServiceOutage: () => { characterServiceOutage = true; },
  disableCharacterServiceOutage: () => { characterServiceOutage = false; },
  enableHealthServiceDegraded: () => { healthServiceDegraded = true; },
  disableHealthServiceDegraded: () => { healthServiceDegraded = false; },
  resetAll: () => {
    outageMode = false;
    catalogOutage = false;
    characterServiceOutage = false;
    healthServiceDegraded = false;
  },
};

/**
 * MSW handlers for Character Service API
 */
export const characterServiceHandlers = [
  // GET /api/catalog/archetypes
  http.get('http://localhost:8080/api/catalog/archetypes', async ({ request }) => {
    // Check for mock scenario headers
    const scenario = request.headers.get('x-mock-scenario');

    if (catalogOutage || outageMode) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Archetype catalog is temporarily unavailable.',
        60
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Network error simulation
    if (scenario === 'network-error') {
      // In MSW, we can't truly simulate network failures, so return 503
      const outageNotice = createOutageNotice(
        'character-service',
        'Network connectivity issues.',
        15
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    const catalog: ArchetypeCatalog = {
      version: '1.0.0',
      archetypes: mockArchetypes,
    };

    return HttpResponse.json(catalog, { status: 200 });
  }),

  // GET /api/players/me/characters
  http.get('http://localhost:8080/api/players/me/characters', async ({ request }) => {
    // Check for mock scenario headers
    const scenario = request.headers.get('x-mock-scenario');
    
    if (scenario === 'outage' || characterServiceOutage || outageMode) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Character roster is temporarily unavailable.',
        30
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Check for authentication header (unless explicitly bypassed)
    const authHeader = request.headers.get('authorization');
    if (!authHeader && scenario !== 'no-auth-bypass') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Authentication required.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 401 }
      );
    }

    // Handle specific scenarios
    if (scenario === 'empty-roster') {
      // Return empty roster
      const mockPlayer: Player = {
        playerId: 'player-001',
        characters: [],
        activeCharacterId: null,
        outage: null,
      };
      return HttpResponse.json(mockPlayer, { status: 200 });
    }

    if (scenario === 'degraded-service') {
      // Return normal roster but with outage notice
      const outageNotice = createOutageNotice(
        'character-service',
        'Service is experiencing performance issues.',
        undefined
      );
      const mockPlayer: Player = {
        playerId: 'player-001',
        characters: mockCharacters,
        activeCharacterId: mockCharacters.length > 0 ? mockCharacters[0]?.id ?? null : null,
        outage: outageNotice,
      };
      return HttpResponse.json(mockPlayer, { status: 200 });
    }

    // Mock player with normal character roster
    const mockPlayer: Player = {
      playerId: 'player-001',
      characters: mockCharacters,
      activeCharacterId: mockCharacters.length > 0 ? mockCharacters[0]?.id ?? null : null,
      outage: null,
    };

    return HttpResponse.json(mockPlayer, { status: 200 });
  }),

  // POST /api/players/me/characters
  http.post('http://localhost:8080/api/players/me/characters', async ({ request }) => {
    // Check for mock scenario headers
    const scenario = request.headers.get('x-mock-scenario');
    
    if (scenario === 'outage' || characterServiceOutage || outageMode) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Character creation is temporarily unavailable.',
        30
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Check for authentication header (unless explicitly bypassed)
    const authHeader = request.headers.get('authorization');
    if (!authHeader && scenario !== 'no-auth-bypass') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Authentication required.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 401 }
      );
    }

    // Check content type
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Content-Type must be application/json.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    let payload: CreateCharacterRequest;
    try {
      payload = (await request.json()) as CreateCharacterRequest;
    } catch {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Invalid JSON request body.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Validate required fields
    if (!payload.name || !payload.archetypeId) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Missing required fields: name and archetypeId.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Validate name pattern - must start with capital letter, followed by lowercase letters only
    if (!/^[A-Z][a-z]+$/.test(payload.name)) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Invalid character name format.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Validate archetype exists
    const archetype = mockArchetypes.find(a => a.id === payload.archetypeId);
    if (!archetype) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Invalid archetype ID.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Check archetype availability
    if (!archetype.isAvailable) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Selected archetype is temporarily unavailable.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Handle specific scenarios
    if (scenario === 'name-collision') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'A character with this name already exists.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 409 }
      );
    }

    if (scenario === 'character-limit' || scenario === 'character-limit-reached') {
      return HttpResponse.json(
        {
          service: 'character-service', 
          message: 'Character limit reached for this account.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 409 }
      );
    }

    if (scenario === 'creation-locked') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Character creation is temporarily locked.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 423 }
      );
    }

    if (scenario === 'service-unavailable') {
      const outageNotice = createOutageNotice(
        'character-service',
        'Character creation service is temporarily unavailable.',
        45
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Create new character
    const newCharacter: Character = {
      id: generateUUID(),
      name: payload.name,
      archetypeId: payload.archetypeId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    return HttpResponse.json(newCharacter, { status: 201 });
  }),

  // POST /api/players/me/characters/{characterId}/select
  http.post('http://localhost:8080/api/players/me/characters/:characterId/select', async ({ request, params }) => {
    const { characterId } = params;
    const scenario = request.headers.get('x-mock-scenario');
    
    if (scenario === 'outage' || characterServiceOutage || outageMode) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Character selection is temporarily unavailable.',
        30
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Check for authentication header (unless explicitly bypassed)
    const authHeader = request.headers.get('authorization');
    if (!authHeader && scenario !== 'no-auth-bypass') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Authentication required.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 401 }
      );
    }

    // Handle missing or empty character ID
    if (!characterId || characterId === '') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Character not found.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 404 }
      );
    }

    // Handle scenario-specific cases BEFORE checking if character exists
    if (scenario === 'retired-character') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Cannot select a retired character.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Validate character ID format - should be UUID-like format
    if (typeof characterId !== 'string' || 
        characterId.length < 30 || // UUIDs are ~36 chars
        characterId.length > 100 ||
        !/^[a-f0-9-]+$/i.test(characterId) || // UUID uses hex digits and dashes
        characterId === 'invalid-uuid') { // Explicitly catch this test case
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Invalid character ID format.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Handle special character ID patterns
    if (characterId.includes('%') || characterId.includes('<') || characterId.includes('>')) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Invalid character ID format.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    // Find character in mock data
    const character = mockCharacters.find(c => c.id === characterId);
    
    if (!character) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Character not found.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 404 }
      );
    }

    if (scenario === 'character-unavailable') {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Character is temporarily unavailable for selection.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 400 }
      );
    }

    if (scenario === 'service-unavailable') {
      const outageNotice = createOutageNotice(
        'character-service',
        'Character selection service is temporarily unavailable.',
        30
      );
      return HttpResponse.json(outageNotice, { status: 503 });
    }

    // Success case - character selection
    return HttpResponse.json(null, { status: 204 });
  }),

  // Handle empty character ID in path
  http.post('http://localhost:8080/api/players/me/characters//select', async ({ request }) => {
    // Check for authentication header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return HttpResponse.json(
        {
          service: 'character-service',
          message: 'Authentication required.',
          retryAfterSeconds: null,
        } as ServiceOutage,
        { status: 401 }
      );
    }

    return HttpResponse.json(
      {
        service: 'character-service',
        message: 'Character not found.',
        retryAfterSeconds: null,
      } as ServiceOutage,
      { status: 404 }
    );
  }),

  // GET /api/service-health/character
  http.get('http://localhost:8080/api/service-health/character', async ({ request }) => {
    const scenario = request.headers.get('x-mock-scenario');
    
    // Handle different health status scenarios
    if (scenario === 'unavailable') {
      const outageNotice = createOutageNotice(
        'character-service',
        'Service is temporarily unavailable for maintenance.',
        300
      );
      const healthResponse: ServiceHealth = {
        service: 'character-service',
        status: 'unavailable',
        outage: outageNotice,
      };
      // Return 200 for unavailable status with outage notice
      return HttpResponse.json(healthResponse, { status: 200 });
    }

    if (scenario === 'unavailable-with-retry') {
      const outageNotice = createOutageNotice(
        'character-service',
        'Service is temporarily unavailable for maintenance.',
        300
      );
      const healthResponse: ServiceHealth = {
        service: 'character-service',
        status: 'unavailable',
        outage: outageNotice,
      };
      return HttpResponse.json(healthResponse, { status: 200 });
    }

    if (scenario === 'degraded' || healthServiceDegraded) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Service is experiencing performance issues.',
        undefined
      );
      const healthResponse: ServiceHealth = {
        service: 'character-service',
        status: 'degraded',
        outage: outageNotice,
      };
      return HttpResponse.json(healthResponse, { status: 200 });
    }

    if (outageMode) {
      const outageNotice = createOutageNotice(
        'character-service',
        'Service is temporarily unavailable.',
        60
      );
      const healthResponse: ServiceHealth = {
        service: 'character-service',
        status: 'unavailable',
        outage: outageNotice,
      };
      return HttpResponse.json(healthResponse, { 
        status: 503,
        headers: {
          'Retry-After': '60'
        }
      });
    }

    // Healthy status
    const healthResponse: ServiceHealth = {
      service: 'character-service',
      status: 'healthy',
      outage: null,
    };
    return HttpResponse.json(healthResponse, { status: 200 });
  }),
];