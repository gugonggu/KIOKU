import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest();

export function shareProof(token: string) {
  return tokenPattern.test(token) ? sha256(token).toString("hex") : null;
}

export function shareKey() {
  const encoded = process.env.KIOKU_SHARE_ENCRYPTION_KEY?.trim();
  if (!encoded || !tokenPattern.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.length === 32 && key.toString("base64url") === encoded ? key : null;
}

function associatedData(tripId: string) {
  return Buffer.from("kioku:share:v1:" + tripId.toLowerCase());
}

export function issueShareToken(tripId: string, key: Buffer) {
  const token = randomBytes(32).toString("base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(tripId));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    encryptedToken: "v1." + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    hash: sha256(sha256(token)).toString("hex"),
  };
}

export function readShareToken(ciphertext: string, tripId: string, key: Buffer) {
  if (!/^v1\.[A-Za-z0-9_-]{95}$/.test(ciphertext)) return null;
  try {
    const payload = Buffer.from(ciphertext.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
    decipher.setAAD(associatedData(tripId));
    decipher.setAuthTag(payload.subarray(12, 28));
    const token = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
    return tokenPattern.test(token) ? token : null;
  } catch {
    return null;
  }
}
