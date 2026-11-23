function readOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const allowedProtocol = url.protocol === "https:" || (loopback && url.protocol === "http:");
    if (!allowedProtocol || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getAuthConfig() {
  const appUrl = readOrigin(process.env.APP_URL?.trim());
  const supabaseUrl = readOrigin(process.env.SUPABASE_URL?.trim());
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!appUrl || !supabaseUrl || !publishableKey?.startsWith("sb_publishable_")) return null;

  return { appUrl, supabaseUrl, publishableKey, secure: appUrl.startsWith("https:") };
}

export function requiresFragmentShareLinks(appUrl = getAuthConfig()?.appUrl) {
  return Boolean(appUrl && new URL(appUrl).hostname.endsWith(".vercel.app"));
}
