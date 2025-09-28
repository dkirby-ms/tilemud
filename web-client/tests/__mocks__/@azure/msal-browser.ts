/**
 * Comprehensive MSAL mock for testing
 * This provides all the MSAL exports that the application uses
 */
import { vi } from 'vitest';

// Mock all the enums and constants
export const BrowserCacheLocation = {
  LocalStorage: 'localStorage',
  SessionStorage: 'sessionStorage',
  MemoryStorage: 'memoryStorage',
} as const;

export const LogLevel = {
  Error: 0,
  Warning: 1,
  Info: 2,
  Verbose: 3,
  Trace: 4,
} as const;

export const InteractionType = {
  Redirect: 'redirect',
  Popup: 'popup',
  Silent: 'silent',
  None: 'none',
} as const;

// Mock error classes
export class InteractionRequiredAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionRequiredAuthError';
  }
}

export class BrowserAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserAuthError';
  }
}

// Mock account info
const mockAccountInfo = {
  homeAccountId: 'mock-home-account-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'mock-tenant-id',
  username: 'test@example.com',
  localAccountId: 'mock-local-account-id',
  name: 'Test User',
  idTokenClaims: {
    aud: 'mock-client-id',
    iss: 'https://login.microsoftonline.com/mock-tenant-id/v2.0',
    sub: 'mock-subject-id',
    name: 'Test User',
    preferred_username: 'test@example.com',
    oid: 'mock-object-id',
    tid: 'mock-tenant-id',
  }
};

// Mock PublicClientApplication
export const PublicClientApplication = vi.fn(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  acquireTokenSilent: vi.fn().mockResolvedValue({
    accessToken: 'mock-access-token',
    account: mockAccountInfo,
    idToken: 'mock-id-token',
    fromCache: true,
    scopes: ['openid', 'profile'],
    correlationId: 'mock-correlation-id',
    expiresOn: new Date(Date.now() + 3600000), // 1 hour from now
    extExpiresOn: new Date(Date.now() + 7200000), // 2 hours from now
    familyId: '',
    serverReceiptTimestamp: Date.now(),
    tenantId: 'mock-tenant-id',
    uniqueId: 'mock-unique-id',
    tokenType: 'Bearer',
  }),
  acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
  loginRedirect: vi.fn().mockResolvedValue(undefined),
  logoutRedirect: vi.fn().mockResolvedValue(undefined),
  logoutPopup: vi.fn().mockResolvedValue(undefined),
  getAllAccounts: vi.fn().mockReturnValue([mockAccountInfo]),
  getAccountByUsername: vi.fn().mockReturnValue(mockAccountInfo),
  getAccountByHomeId: vi.fn().mockReturnValue(mockAccountInfo),
  getAccountByLocalId: vi.fn().mockReturnValue(mockAccountInfo),
  setActiveAccount: vi.fn(),
  getActiveAccount: vi.fn().mockReturnValue(mockAccountInfo),
  handleRedirectPromise: vi.fn().mockResolvedValue({
    account: mockAccountInfo,
    accessToken: 'mock-access-token',
    idToken: 'mock-id-token',
    fromCache: false,
    scopes: ['openid', 'profile'],
    correlationId: 'mock-correlation-id',
    expiresOn: new Date(Date.now() + 3600000),
    extExpiresOn: new Date(Date.now() + 7200000),
    familyId: '',
    serverReceiptTimestamp: Date.now(),
    tenantId: 'mock-tenant-id',
    uniqueId: 'mock-unique-id',
    tokenType: 'Bearer',
  }),
  addEventCallback: vi.fn(),
  removeEventCallback: vi.fn(),
  enableAccountStorageEvents: vi.fn(),
  disableAccountStorageEvents: vi.fn(),
  getTokenCache: vi.fn().mockReturnValue({
    loadExternalTokens: vi.fn(),
  }),
}));

// Export mock account for test use
export const mockAccount = mockAccountInfo;