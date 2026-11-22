import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const ownerA = "1029f67a-eee8-4437-be1c-dca04b942013";
export const ownerB = "6dc81a27-e369-4e12-9f3d-5d7e3619cb25";

export async function createTripsDatabase() {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable
        as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
      create function auth.uid() returns uuid language sql stable
        as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated;
    `);
    await database.query("insert into auth.users (id) values ($1), ($2)", [ownerA, ownerB]);
    const migration = await readFile("supabase/migrations/20261122073111_create_trips.sql", "utf8");
    await database.exec(migration);
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

/**
 * @template T
 * @param {PGlite} database
 * @param {string | null} userId
 * @param {(transaction: import("@electric-sql/pglite").Transaction) => Promise<T>} callback
 * @param {boolean} [isAnonymous]
 */
export function asUser(database, userId, callback, isAnonymous = false) {
  return database.transaction(async (transaction) => {
    await transaction.exec(userId ? "set local role authenticated" : "set local role anon");
    await transaction.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, is_anonymous: isAnonymous } : {}),
    ]);
    return callback(transaction);
  });
}
