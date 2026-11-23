import { createHash, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { issueShareToken, readShareToken, shareProof } from "../src/lib/trip-share-token.ts";

test("share tokens use independent nonces, authenticated encryption and a distinct stored hash", () => {
  const key = randomBytes(32);
  const trip = randomUUID();
  const value = issueShareToken(trip, key);
  const token = readShareToken(value.encryptedToken, trip, key);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(value.encryptedToken.includes(token), false);
  assert.equal(readShareToken(value.encryptedToken, randomUUID(), key), null);
  assert.equal(readShareToken(value.encryptedToken, trip, randomBytes(32)), null);
  const suffix = value.encryptedToken[20] === "A" ? "B" : "A";
  assert.equal(readShareToken(value.encryptedToken.slice(0, 20) + suffix + value.encryptedToken.slice(21), trip, key), null);
  assert.notEqual(issueShareToken(trip, key).hash, value.hash);
  const proof = shareProof(token);
  assert.notEqual(proof, value.hash);
  assert.equal(createHash("sha256").update(Buffer.from(proof, "hex")).digest("hex"), value.hash);
  assert.equal(shareProof("malformed"), null);
});
