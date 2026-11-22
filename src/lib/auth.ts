import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "./database.types";
import { getAuthConfig } from "./auth-config";

export async function createAuthClient() {
  const config = getAuthConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  return createServerClient<Database>(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: config.secure },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(items) {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch (error) {
          // Server Components are read-only. Proxy refreshes cookies before rendering.
          if (!(error instanceof Error) || !error.message.includes("Cookies can only be modified")) throw error;
        }
      },
    },
  });
}

export const getVerifiedUserId = cache(async () => {
  const client = await createAuthClient();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getClaims();
    const claims = data?.claims;
    if (error || claims?.role !== "authenticated" || claims.is_anonymous || !claims.sub) return null;
    return claims.sub;
  } catch {
    return null;
  }
});

export async function requireUser() {
  const userId = await getVerifiedUserId();
  if (!userId) redirect("/login");
  return userId;
}
