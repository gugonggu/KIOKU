import { createAuthClient } from "@/lib/auth";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  let destination = "/login?notice=link";

  try {
    const client = await createAuthClient();
    if (client && code && !tokenHash) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (!error && data.session) destination = "/trips";
    } else if (client && !code && tokenHash && params.get("type") === "email") {
      const { data, error } = await client.auth.verifyOtp({ type: "email", token_hash: tokenHash });
      if (!error && data.session) destination = "/trips";
    }
  } catch {
    // A missing, expired, or unverified link always returns to login.
  }

  return new Response(null, {
    status: 303,
    headers: { Location: destination, "Cache-Control": "private, no-store" },
  });
}
