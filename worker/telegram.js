import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

let clientPromise;

async function telegramClient(env) {
  if (!env.TG_API_ID || !env.TG_API_HASH || !env.TG_SESSION_STRING) {
    throw new Error("Telegram credentials are not configured");
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new TelegramClient(
        new StringSession(env.TG_SESSION_STRING),
        Number(env.TG_API_ID),
        env.TG_API_HASH,
        { connectionRetries: 1, requestRetries: 1, autoReconnect: false },
      );
      await client.connect();
      if (!(await client.isUserAuthorized())) throw new Error("Telegram session is not authorized");
      return client;
    })().catch((error) => { clientPromise = undefined; throw error; });
  }
  const client = await clientPromise;
  if (!client.connected) {
    clientPromise = undefined;
    return telegramClient(env);
  }
  return client;
}

function id(value) {
  return value?.toString() ?? null;
}

function entityType(entity) {
  if (entity instanceof Api.Channel) return entity.broadcast ? "channel" : "supergroup";
  if (entity instanceof Api.Chat) return "group";
  if (entity instanceof Api.User) return "user";
  return "unknown";
}

function peerKey(peer) {
  if (peer instanceof Api.InputPeerChannel || peer instanceof Api.PeerChannel) return `channel:${id(peer.channelId)}`;
  if (peer instanceof Api.InputPeerChat || peer instanceof Api.PeerChat) return `chat:${id(peer.chatId)}`;
  if (peer instanceof Api.InputPeerUser || peer instanceof Api.PeerUser) return `user:${id(peer.userId)}`;
  return null;
}

function entityKey(entity) {
  const type = entityType(entity);
  return type === "channel" || type === "supergroup" ? `channel:${id(entity.id)}` : `${type === "group" ? "chat" : type}:${id(entity.id)}`;
}

function summary(dialog) {
  const entity = dialog.entity;
  return {
    id: id(dialog.id),
    title: dialog.name || dialog.title || entity?.title || entity?.firstName || "",
    username: entity?.username ?? null,
    type: entityType(entity),
    unread_count: dialog.unreadCount ?? 0,
  };
}

async function folders(client) {
  const result = await client.invoke(new Api.messages.GetDialogFilters({}));
  return (result.filters ?? result).filter(
    (folder) => folder instanceof Api.DialogFilter || folder instanceof Api.DialogFilterChatlist,
  );
}

function folderTitle(folder) {
  return typeof folder.title === "string" ? folder.title : folder.title?.text ?? String(folder.title);
}

function findByName(items, name, getName, kind) {
  const needle = name.trim().toLowerCase();
  if (!needle) throw new Error(`${kind} name is required`);
  const exact = items.find((item) => getName(item).trim().toLowerCase() === needle);
  const partial = items.find((item) => getName(item).trim().toLowerCase().includes(needle));
  if (!exact && !partial) throw new Error(`${kind} not found: ${name}`);
  return exact ?? partial;
}

async function resolveChat(client, chat) {
  const name = String(chat).trim();
  if (!name) throw new Error("Chat name is required");
  if (name.startsWith("@")) return client.getEntity(name);
  const dialogs = await client.getDialogs({ limit: 500 });
  if (/^-?\d+$/.test(name)) {
    const dialog = dialogs.find((item) => id(item.id) === name || id(item.entity?.id) === name.replace(/^-100/, ""));
    if (dialog) return dialog.entity;
    return client.getEntity(name);
  }
  return findByName(dialogs, name, (dialog) => dialog.name || dialog.title || "", "Chat").entity;
}

async function forumTopics(client, entity) {
  if (!entity.forum) return [];
  const result = await client.invoke(new Api.channels.GetForumTopics({
    channel: entity,
    offsetDate: 0,
    offsetId: 0,
    offsetTopic: 0,
    limit: 100,
    q: "",
  }));
  return result.topics ?? [];
}

export async function listChatFolders(env) {
  const client = await telegramClient(env);
  return (await folders(client)).map((folder) => ({
    id: folder.id,
    title: folderTitle(folder),
    chat_count: folder.includePeers?.length ?? 0,
  }));
}

export async function listChatsInFolder(env, folderTitleQuery) {
  const client = await telegramClient(env);
  const folder = findByName(await folders(client), folderTitleQuery, folderTitle, "Folder");
  const keys = new Set((folder.includePeers ?? []).map(peerKey).filter(Boolean));
  const dialogs = await client.getDialogs({ limit: 500 });
  return dialogs.filter((dialog) => keys.has(entityKey(dialog.entity))).map(summary);
}

export async function listDialogs(env, query, limit = 50) {
  const client = await telegramClient(env);
  const capped = Math.max(1, Math.min(100, Number(limit) || 50));
  const dialogs = await client.getDialogs({ limit: query ? 500 : capped });
  const needle = String(query ?? "").trim().toLowerCase();
  return dialogs.filter((dialog) => !needle || (dialog.name || dialog.title || "").toLowerCase().includes(needle))
    .slice(0, capped).map(summary);
}

export async function getChatInfo(env, chat) {
  const client = await telegramClient(env);
  const entity = await resolveChat(client, chat);
  return {
    id: id(entity.id),
    title: entity.title ?? entity.firstName ?? null,
    username: entity.username ?? null,
    type: entityType(entity),
    participants_count: entity.participantsCount ?? null,
  };
}

export async function listTopics(env, chat) {
  const client = await telegramClient(env);
  const entity = await resolveChat(client, chat);
  return (await forumTopics(client, entity)).map((topic) => ({
    id: topic.id,
    title: topic.title,
    closed: Boolean(topic.closed),
    pinned: Boolean(topic.pinned),
  }));
}

export async function getRecentMessages(env, chat, limit = 10, topic) {
  const client = await telegramClient(env);
  const entity = await resolveChat(client, chat);
  const capped = Math.max(1, Math.min(100, Number(limit) || 10));
  let replyTo;
  if (topic !== undefined && topic !== null && String(topic).trim()) {
    const topics = await forumTopics(client, entity);
    const selected = /^\d+$/.test(String(topic))
      ? topics.find((item) => item.id === Number(topic))
      : findByName(topics, String(topic), (item) => item.title, "Topic");
    if (!selected) throw new Error(`Topic not found: ${topic}`);
    replyTo = selected.id;
  }
  const messages = await client.getMessages(entity, { limit: capped, ...(replyTo ? { replyTo } : {}) });
  return messages.map(messageSummary);
}

function messageSummary(message) {
  const media = message.media;
  const mediaType = media instanceof Api.MessageMediaPhoto ? "photo"
    : media instanceof Api.MessageMediaDocument ? "document"
    : media ? "other" : null;
  return {
    id: message.id,
    date: message.date ? new Date(message.date * 1000).toISOString() : null,
    sender: message.postAuthor ?? id(message.senderId),
    text: message.message ?? "",
    has_media: Boolean(mediaType),
    media_type: mediaType,
  };
}

export async function searchMessages(env, chat, query, topic, limit = 20) {
  const client = await telegramClient(env);
  const entity = await resolveChat(client, chat);
  const needle = String(query).trim();
  if (!needle) throw new Error("Search query is required");
  const capped = Math.max(1, Math.min(100, Number(limit) || 20));
  let replyTo;
  if (topic !== undefined && topic !== null && String(topic).trim()) {
    const topics = await forumTopics(client, entity);
    const selected = /^\d+$/.test(String(topic))
      ? topics.find((item) => item.id === Number(topic))
      : findByName(topics, String(topic), (item) => item.title, "Topic");
    if (!selected) throw new Error(`Topic not found: ${topic}`);
    replyTo = selected.id;
  }
  // Telegram does not combine server-side search with a reply thread filter.
  // For topics, inspect a bounded recent window and filter it locally.
  const messages = replyTo
    ? await client.getMessages(entity, { replyTo, limit: 100 })
    : await client.getMessages(entity, { search: needle, limit: capped });
  return messages.filter((message) => !replyTo || (message.message ?? "").toLowerCase().includes(needle.toLowerCase()))
    .slice(0, capped).map(messageSummary);
}

export async function getMessagePhoto(env, chat, messageId) {
  const client = await telegramClient(env);
  const entity = await resolveChat(client, chat);
  const messages = await client.getMessages(entity, { ids: Number(messageId) });
  const message = messages[0];
  if (!message) throw new Error("Message not found");
  if (!(message.media instanceof Api.MessageMediaPhoto)) throw new Error("Message has no photo");
  const photo = await client.downloadMedia(message, {});
  if (!photo || typeof photo === "string") throw new Error("Photo download failed");
  if (photo.length > 5_000_000) throw new Error("Photo is too large for an MCP response");
  return { data: photo.toString("base64"), mimeType: "image/jpeg" };
}
