"use server";

import { createAuthClient } from "@/lib/auth";
import { getAuthConfig } from "@/lib/auth-config";

export type LoginState = { status: "idle" | "invalid" | "sent" | "limited" | "error" | "unconfigured" };

export async function requestLoginLink(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const value = formData.get("email");
  const email = typeof value === "string" ? value.trim() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "invalid" };
  }

  const config = getAuthConfig();
  if (!config) return { status: "unconfigured" };

  try {
    const client = await createAuthClient();
    if (!client) return { status: "unconfigured" };
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: new URL("/auth/confirm", config.appUrl).href,
        shouldCreateUser: false,
      },
    });

    if (!error || ["otp_disabled", "user_not_found", "signup_disabled"].includes(error.code ?? "")) {
      return { status: "sent" };
    }
    if (error.status === 429) return { status: "limited" };
  } catch {
    // Provider diagnostics may contain submitted data. Return a generic error.
  }
  return { status: "error" };
}
