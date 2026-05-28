/**
 * Minimal ambient types for Node 24's built-in `node:sqlite`.
 * @types/node@20 (pinned here) predates these; only the subset we use is declared.
 * Remove once @types/node is bumped to a version that ships node:sqlite types.
 */
declare module "node:sqlite" {
  type SQLInputValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLInputValue[]): unknown;
    all(...params: SQLInputValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
