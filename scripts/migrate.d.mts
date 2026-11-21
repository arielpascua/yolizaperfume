import type { PoolClient, Client } from 'pg';

/** Applies every pending migration in `dir`. Returns the file names applied this run. */
export function migrate(client: Client | PoolClient, dir: string): Promise<string[]>;
