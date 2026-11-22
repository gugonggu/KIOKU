"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth";

export async function signOut(): Promise<{ failed: boolean }> {
  try {
    const client = await createAuthClient();
    if (client) {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error && error.name !== "AuthSessionMissingError") return { failed: true };
    }
  } catch {
    return { failed: true };
  }
  redirect("/login");
}
