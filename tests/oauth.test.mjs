import assert from "node:assert/strict";
import { test } from "node:test";
import { authHandler, AUTHORIZE_PATH, SCOPE } from "../worker/oauth.js";

const base = `https://verdian.io.kr${AUTHORIZE_PATH}?client_id=chatgpt&state=abc`;
const ownerToken = "a".repeat(64);

function env() {
  let approved = 0;
  return {
    MCP_AUTH_TOKEN: ownerToken,
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return { clientId: "chatgpt", scope: [SCOPE], state: "abc" };
      },
      async lookupClient() { return { clientName: "ChatGPT" }; },
      async completeAuthorization({ userId, scope }) {
        assert.equal(userId, "telegram-owner");
        assert.deepEqual(scope, [SCOPE]);
        approved++;
        return { redirectTo: "https://chatgpt.com/connector/oauth/callback?code=test" };
      },
    },
    get approved() { return approved; },
  };
}

function csrfFrom(html) {
  return html.match(/name="csrf" value="([a-f0-9.]+)"/)?.[1];
}

test("owner token and signed approval form are required without browser cookies", async () => {
  const state = env();
  const page = await authHandler.fetch(new Request(base), state);
  assert.equal(page.status, 200);
  const csrf = csrfFrom(await page.text());
  assert.match(csrf, /^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(page.headers.get("Set-Cookie"), null);
  assert.equal(state.approved, 0);

  async function submit(token, proof = csrf, requestUrl = base) {
    return authHandler.fetch(new Request(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: proof, owner_token: token }),
    }), state);
  }

  const expired = await submit(ownerToken, "invalid");
  assert.equal(expired.status, 200);
  assert.match(await expired.text(), /승인 페이지가 만료되었습니다/);
  const wrongRequest = await submit(ownerToken, csrf, `${base}&extra=1`);
  assert.match(await wrongRequest.text(), /승인 페이지가 만료되었습니다/);
  assert.equal(state.approved, 0);
  assert.equal((await submit("wrong")).status, 200);
  assert.equal(state.approved, 0);
  const approved = await submit(ownerToken);
  assert.equal(approved.status, 302);
  assert.match(approved.headers.get("Location"), /^https:\/\/chatgpt\.com\/connector\/oauth\/callback/);
  assert.equal(state.approved, 1);
});
