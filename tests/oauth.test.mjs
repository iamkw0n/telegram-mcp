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
  return html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
}

test("owner token and same-site CSRF are required before an OAuth grant", async () => {
  const state = env();
  const page = await authHandler.fetch(new Request(base), state);
  assert.equal(page.status, 200);
  const csrf = csrfFrom(await page.text());
  assert.equal(csrf?.length, 64);
  assert.match(page.headers.get("Set-Cookie"), new RegExp(`__Host-telegram-csrf=${csrf}`));
  assert.equal(state.approved, 0);

  async function submit(token, cookie) {
    return authHandler.fetch(new Request(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ csrf, owner_token: token }),
    }), state);
  }

  const expired = await submit(ownerToken, "");
  assert.equal(expired.status, 200);
  assert.match(await expired.text(), /승인 페이지가 만료되었습니다/);
  assert.match(expired.headers.get("Set-Cookie"), /Max-Age=1800/);
  assert.equal(state.approved, 0);
  assert.equal((await submit("wrong", `__Host-telegram-csrf=${csrf}`)).status, 200);
  assert.equal(state.approved, 0);
  const approved = await submit(ownerToken, `__Host-telegram-csrf=${csrf}`);
  assert.equal(approved.status, 302);
  assert.match(approved.headers.get("Location"), /^https:\/\/chatgpt\.com\/connector\/oauth\/callback/);
  assert.equal(state.approved, 1);
});
