import { createAuthClient } from "@/lib/auth";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const google = params.get("flow") === "google";
  const errorCode = params.get("error_code");
  let destination = google ? "/login?notice=google" : "/login?notice=link";

  if (google && errorCode === "signup_disabled") {
    destination = "/login?notice=google-account";
  } else if (!params.has("error") && !errorCode) {
    try {
      const client = await createAuthClient();
      if (client && code && !tokenHash) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (!error && data.session) destination = "/trips";
      } else if (client && !google && !code && tokenHash && params.get("type") === "email") {
        const { data, error } = await client.auth.verifyOtp({ type: "email", token_hash: tokenHash });
        if (!error && data.session) destination = "/trips";
      }
    } catch {
      // Failed callbacks return to login without exposing provider diagnostics.
    }
  }

  return new Response(null, {
    status: 303,
    headers: { Location: destination, "Cache-Control": "private, no-store" },
  });
}
