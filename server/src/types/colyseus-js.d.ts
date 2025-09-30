// Shim to ensure TypeScript resolves colyseus.js types (package provides d.ts but path mapping may need hint)
declare module "colyseus.js" {
  // Re-export all types from the bundled declaration file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class Client {
    constructor(endpoint: string);
    joinOrCreate(room: string, options?: Record<string, unknown>): Promise<Room>;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface Room<_TState = any> {
    send(type: string, payload?: unknown): void;
    leave(consented?: boolean): void;
    onMessage(type: string, cb: (message: unknown) => void): void;
  }
}