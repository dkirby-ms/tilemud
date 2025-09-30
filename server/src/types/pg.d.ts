// Temporary type definitions for pg module
declare module 'pg' {
  export interface QueryResult<R = any> {
    command: string;
    rowCount: number | null;
    oid: number;
    rows: R[];
    fields: any[];
  }

  export interface PoolClient {
    query<R = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: any);
    query<R = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}