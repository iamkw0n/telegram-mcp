# Cloudflare Workers deployment

This directory also contains a Cloudflare Worker implementation of the read-only personal Telegram MCP server. The existing Python server remains available for local use.

## Endpoint

`https://verdian.io.kr/mcp/telegram`

The Worker route is limited to this path and its children. The Worker itself accepts only the exact endpoint path. The apex DNS record must remain proxied by Cloudflare.

## Authentication

Create a Cloudflare Access **self-hosted application** protecting `verdian.io.kr/mcp/telegram`. Add a policy allowing only the owner's identity, enable **Managed OAuth**, and use a short access-token lifetime. The Worker independently verifies the `Cf-Access-Jwt-Assertion` signature, issuer, application audience, expiry, and owner email.

Set these non-secret Worker variables:

- `CF_ACCESS_TEAM_DOMAIN`: the Zero Trust team domain, including `https://`, such as `https://team.cloudflareaccess.com`
- `CF_ACCESS_AUD`: the Access application audience tag
- `ALLOWED_EMAIL`: the owner's login email address

Set these Worker secrets from the existing local `.env` without committing or printing their values:

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION_STRING`

The `TG_SESSION_STRING` grants access to the Telegram account. The Worker has no message-sending tools, but anyone holding that string can use it independently. Never put it in source, GitHub Actions logs, or Wrangler config.

`keep_vars` is enabled in `wrangler.jsonc` so GitHub-triggered deployments preserve the three non-secret variables managed in the Cloudflare dashboard. Encrypted secrets are preserved by Wrangler deployments.

Disable the `workers.dev` route. The checked-in Wrangler config already requests this. The Worker also rejects any host other than `verdian.io.kr`.

## Deploy and verify

```sh
npm install
npm test
npm run check
npm run deploy
```

Confirm the Cloudflare deployment, the Access policy, and a real MCP `tools/list` and read-only Telegram tool call at the custom URL. An HTTP status alone does not verify Telegram connectivity or MCP behavior.

Telegram's API cannot combine message search with a forum topic reply filter. Topic search filters only that topic's latest 100 messages. Dialog title matching checks at most 500 dialogs per call.

Cloudflare Workers Free has a 10 ms CPU limit per HTTP request. GramJS may exceed it on Telegram connection setup, cryptography, or photo handling. Check the live invocation result and CPU usage before treating the free plan deployment as working. If it exceeds that limit, this implementation needs a different runtime or plan; a successful upload alone is insufficient.
