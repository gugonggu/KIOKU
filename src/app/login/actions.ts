"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth";
import { getAuthConfig } from "@/lib/auth-config";

export type LoginState = { status: "idle" | "invalid" | "sent" | "limited" | "error" | "unconfigured" };
export type GoogleLoginState = "idle" | "unavailable" | "error";

export async function startGoogleLogin(): Promise<GoogleLoginState> {
  const config = getAuthConfig();
  if (!config) return "unavailable";

  let authorizeUrl: string;
  try {
    const response = await fetch(new URL("/auth/v1/settings", config.supabaseUrl), {
      cache: "no-store",
      headers: { apikey: config.publishableKey },
    });
    if (!response.ok) return "unavailable";
    const settings: { disable_signup?: boolean; external?: { google?: boolean } } = await response.json();
    // OAuth can create a user unless signup is disabled at the Auth server.
    if (settings.disable_signup !== true || settings.external?.google !== true) return "unavailable";

    const client = await createAuthClient();
    if (!client) return "unavailable";
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: new URL("/auth/confirm?flow=google", config.appUrl).href },
    });
    if (error || !data.url) return "error";
    authorizeUrl = data.url;
  } catch {
    // Avoid logging provider responses and authorization URLs.
    return "error";
  }
  redirect(authorizeUrl);
}

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
