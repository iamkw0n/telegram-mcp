import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyAccess } from "../worker/access.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const env = {
  CF_ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  CF_ACCESS_AUD: "audience",
  ALLOWED_EMAIL: "owner@example.com",
};
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });

function token(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: env.CF_ACCESS_TEAM_DOMAIN,
    aud: [env.CF_ACCESS_AUD],
    email: env.ALLOWED_EMAIL,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...claims,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function request(value) {
  return new Request("https://verdian.io.kr/mcp/telegram", {
    headers: value ? { "Cf-Access-Jwt-Assertion": value } : {},
  });
}

test("Cloudflare Access token validation accepts only the owner and intended app", async () => {
  try {
    assert.equal(await verifyAccess(request(token()), env), true);
    assert.equal(await verifyAccess(request(token({ email: "other@example.com" })), env), false);
    assert.equal(await verifyAccess(request(token({ aud: ["other-app"] })), env), false);
    assert.equal(await verifyAccess(request(token({ exp: 1 })), env), false);
    assert.equal(await verifyAccess(request(), env), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
