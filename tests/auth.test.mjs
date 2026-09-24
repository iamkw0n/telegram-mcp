import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyBearerToken } from "../worker/auth.js";

const env = { MCP_AUTH_TOKEN: "a".repeat(43) };
const request = (headers = {}) => new Request("https://verdian.io.kr/mcp/telegram", { headers });

test("only the configured bearer token authenticates", async () => {
  assert.equal(await verifyBearerToken(request({ Authorization: `Bearer ${env.MCP_AUTH_TOKEN}` }), env), true);
  assert.equal(await verifyBearerToken(request(), env), false);
  assert.equal(await verifyBearerToken(request({ Authorization: `Bearer ${"b".repeat(43)}` }), env), false);
  assert.equal(await verifyBearerToken(request({ Authorization: `Basic ${env.MCP_AUTH_TOKEN}` }), env), false);
  assert.equal(await verifyBearerToken(request({ "Cf-Access-Jwt-Assertion": "old-access-token" }), env), false);
  assert.equal(await verifyBearerToken(request({ Authorization: `Bearer ${env.MCP_AUTH_TOKEN}` }), {}), false);
});
