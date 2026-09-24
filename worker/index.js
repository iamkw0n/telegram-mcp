import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { verifyBearerToken } from "./auth.js";
import { authHandler, AUTHORIZE_PATH, RESOURCE, SCOPE } from "./oauth.js";
import {
  getChatInfo,
  getMessagePhoto,
  getRecentMessages,
  listChatFolders,
  listChatsInFolder,
  listDialogs,
  listTopics,
  searchMessages,
} from "./telegram.js";

const MCP_PATH = "/mcp/telegram";

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function runTool(operation) {
  try {
    return toolResult(await operation());
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : "Telegram request failed" }],
      isError: true,
    };
  }
}

function createServer(env) {
  const server = new McpServer({ name: "telegram-mcp", version: "0.1.0" });

  server.registerTool("list_chat_folders", {
    description: "List the connected Telegram account's chat folders.",
    inputSchema: {},
  }, async () => runTool(() => listChatFolders(env)));

  server.registerTool("list_chats_in_folder", {
    description: "List chats and channels explicitly included in a named Telegram folder.",
    inputSchema: { folder_title: z.string().min(1) },
  }, async ({ folder_title }) => runTool(() => listChatsInFolder(env, folder_title)));

  server.registerTool("list_dialogs", {
    description: "List or search Telegram dialogs by title.",
    inputSchema: {
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ query, limit }) => runTool(() => listDialogs(env, query, limit)));

  server.registerTool("get_chat_info", {
    description: "Get basic information about a chat by title, username, or ID.",
    inputSchema: { chat: z.string().min(1) },
  }, async ({ chat }) => runTool(() => getChatInfo(env, chat)));

  server.registerTool("list_topics", {
    description: "List forum topics inside a Telegram supergroup.",
    inputSchema: { chat: z.string().min(1) },
  }, async ({ chat }) => runTool(() => listTopics(env, chat)));

  server.registerTool("get_recent_messages", {
    description: "Read recent messages from a chat or one of its forum topics.",
    inputSchema: {
      chat: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      topic: z.string().optional(),
    },
  }, async ({ chat, limit, topic }) => runTool(() => getRecentMessages(env, chat, limit, topic)));

  server.registerTool("search_messages", {
    description: "Search messages in a chat, or search the latest 100 messages in a forum topic for a keyword.",
    inputSchema: {
      chat: z.string().min(1),
      query: z.string().min(1),
      topic: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ chat, query, topic, limit }) => runTool(() => searchMessages(env, chat, query, topic, limit)));

  server.registerTool("get_message_photo", {
    description: "Return the photo attached to one Telegram message as MCP image content.",
    inputSchema: { chat: z.string().min(1), message_id: z.number().int().positive() },
  }, async ({ chat, message_id }) => {
    try {
      const image = await getMessagePhoto(env, chat, message_id);
      return { content: [{ type: "image", ...image }] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "Photo request failed" }], isError: true };
    }
  });

  return server;
}

function handleMcp(request, env, ctx) {
  return createMcpHandler(() => createServer(env), {
      route: MCP_PATH,
      responseMode: "json",
      allowedHostnames: ["verdian.io.kr"],
      allowedOriginHostnames: ["verdian.io.kr", "chatgpt.com", "claude.ai"],
      corsOptions: false,
  })(request, env, ctx);
}

const oauthProvider = new OAuthProvider({
  apiRoute: MCP_PATH,
  apiHandler: {
    fetch(request, env, ctx) {
      if (ctx.props?.userId !== "telegram-owner" || !ctx.auth?.scope?.includes(SCOPE)) {
        return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
      }
      return handleMcp(request, env, ctx);
    },
  },
  defaultHandler: authHandler,
  authorizeEndpoint: AUTHORIZE_PATH,
  tokenEndpoint: "/oauth/telegram/token",
  clientRegistrationEndpoint: "/oauth/telegram/register",
  scopesSupported: [SCOPE],
  resourceMetadata: {
    resource: RESOURCE,
    authorization_servers: ["https://verdian.io.kr"],
    scopes_supported: [SCOPE],
    resource_name: "Verdian Telegram MCP",
  },
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== "verdian.io.kr" || url.protocol !== "https:") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === MCP_PATH && await verifyBearerToken(request, env)) {
      return handleMcp(request, env, ctx);
    }
    return oauthProvider.fetch(request, env, ctx);
  },
};
