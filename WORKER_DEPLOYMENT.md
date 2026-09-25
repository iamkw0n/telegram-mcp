# Cloudflare Workers deployment

This directory also contains a Cloudflare Worker implementation of the read-only personal Telegram MCP server. The existing Python server remains available for local use.

## Endpoint

`https://verdian.io.kr/mcp/telegram`

The MCP endpoint accepts only the exact path. OAuth metadata and authorization endpoints also run on `verdian.io.kr`; the apex DNS record must remain proxied by Cloudflare.

## Authentication

The Worker accepts either the owner bearer token for direct MCP clients or a scoped OAuth access token issued through its owner approval page. Unauthenticated MCP requests receive an OAuth resource metadata challenge. No Cloudflare Access application is required.

Generate a random token locally and store it as the encrypted Worker secret `MCP_AUTH_TOKEN`. Keep the same value in the private, ignored local `.env` file. Do not put it in `wrangler.jsonc`, source code, GitHub, or logs. The OAuth approval page asks for this token to authorize a client to use read-only Telegram tools. The token is verified by the Worker and is not sent to the client.

OAuth client registration, authorization, token exchange, and protected resource metadata are available at `/oauth/telegram/register`, `/oauth/telegram/authorize`, `/oauth/telegram/token`, and `/.well-known/oauth-protected-resource/mcp/telegram`. The provider stores client registrations and grants in the `OAUTH_KV` namespace. Access tokens last one hour and refresh tokens last 30 days. The only granted scope is `telegram:read`.

Set these Worker secrets from the existing local `.env` without committing or printing their values:

- `TG_API_ID`
- `TG_API_HASH`
- `TG_SESSION_STRING`
- `MCP_AUTH_TOKEN`

The `TG_SESSION_STRING` grants access to the Telegram account. The Worker has no message-sending tools, but anyone holding that string can use it independently. Never put it in source, GitHub Actions logs, or Wrangler config.

`keep_vars` is disabled in `wrangler.jsonc` so deployments remove obsolete plain-text variables, including the former Access settings. Encrypted secrets are preserved by Wrangler deployments.

Disable the `workers.dev` route. The checked-in Wrangler config already requests this. The Worker also rejects any host other than `verdian.io.kr`.

## Deploy and verify

```sh
npm install
npm test
npm run check
npm run deploy
```

Confirm the Cloudflare deployment, unauthenticated OAuth challenge, OAuth authorization-code exchange, authenticated MCP `tools/list`, and a read-only Telegram tool call at the custom URL. An HTTP status alone does not verify Telegram connectivity or MCP behavior.

## Connect to ChatGPT web

Enable Developer mode under ChatGPT Settings > Security and login. Under Plugins, create a custom MCP plugin with server URL `https://verdian.io.kr/mcp/telegram` and OAuth authentication. ChatGPT discovers the OAuth endpoints from the Worker. When redirected to the Verdian approval page, enter the owner token from the local `.env` file yourself and approve read-only access. Check that ChatGPT lists the nine Telegram tools and can run a read-only tool before considering the connection complete. Do not paste `TG_SESSION_STRING` into ChatGPT.

For a large history, call `get_message_history` with a chat title or ID and optionally a forum topic. It returns up to 1,000 messages, with a response budget near 200 KB. If `has_more` is true, pass `next_before_message_id` as `before_message_id` in the next call. Repeat until `has_more` is false. The cursor is exclusive, so consecutive pages do not repeat the last message.

Telegram's API cannot combine message search with a forum topic reply filter. Topic search filters only that topic's latest 100 messages. Dialog title matching checks at most 500 dialogs per call.

Cloudflare Workers Free has a 10 ms CPU limit per HTTP request. GramJS may exceed it on Telegram connection setup, cryptography, or photo handling. Check the live invocation result and CPU usage before treating the free plan deployment as working. If it exceeds that limit, this implementation needs a different runtime or plan; a successful upload alone is insufficient.
