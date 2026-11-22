import { createAuthClient } from "@/lib/auth";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get("token_hash");
  let destination = "/login?notice=link";

  if (tokenHash && params.get("type") === "email") {
    try {
      const client = await createAuthClient();
      if (client) {
        const { error } = await client.auth.verifyOtp({ type: "email", token_hash: tokenHash });
        if (!error) destination = "/trips";
      }
    } catch {
      // A missing, expired, or unverified link always returns to login.
    }
  }

  return new Response(null, {
    status: 303,
    headers: { Location: destination, "Cache-Control": "private, no-store" },
  });
}
