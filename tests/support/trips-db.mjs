import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const ownerA = "1029f67a-eee8-4437-be1c-dca04b942013";
export const ownerB = "6dc81a27-e369-4e12-9f3d-5d7e3619cb25";

/** @param {{ beforeMigration?: (database: PGlite, file: string) => Promise<void> }} [options] */
export async function createTripsDatabase(options = {}) {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit integer, allowed_mime_types text[]);
      create table storage.objects (bucket_id text not null references storage.buckets(id), name text not null);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select on storage.objects to authenticated;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable
        as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
      create function auth.uid() returns uuid language sql stable
        as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated;
    `);
    await database.query("insert into auth.users (id) values ($1), ($2)", [ownerA, ownerB]);
    const directory = "supabase/migrations";
    const migrations = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
    for (const migration of migrations) {
      await options.beforeMigration?.(database, migration);
      await database.exec(await readFile(`${directory}/${migration}`, "utf8"));
    }
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
