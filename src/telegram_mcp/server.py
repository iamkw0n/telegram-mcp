"""Read-only MCP server exposing the user's personal Telegram account.

Tools let an MCP client (ChatGPT, Claude, ...) browse Telegram "chat folders",
list the chats/channels inside a folder, search all dialogs, list forum
topics inside a chat, and read the most recent messages of a chat or a
specific topic. Nothing here can send messages or otherwise mutate the
account — the scope is intentionally read-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.github import GitHubProvider
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware
from telethon.tl.functions.messages import GetDialogFiltersRequest, GetForumTopicsRequest
from telethon.tl.types import (
    Channel,
    Chat,
    DialogFilter,
    DialogFilterChatlist,
    InputPeerChannel,
    InputPeerChat,
    InputPeerUser,
    User,
)

from . import config
from .telegram_client import get_client

class OwnerOnlyMiddleware(Middleware):
    """Rejects tool calls unless the authenticated GitHub login is the owner.

    GitHubProvider only proves *some* GitHub account logged in — anyone with
    the connector URL could otherwise complete the OAuth flow with their own
    GitHub account and read the owner's Telegram messages. This closes that
    gap by checking the verified `login` claim on every tool call.
    """

    def __init__(self, allowed_login: str):
        self._allowed_login = allowed_login.lower()

    async def on_call_tool(self, context, call_next):
        token = get_access_token()
        login = (token.claims or {}).get("login") if token else None
        if login is None or login.lower() != self._allowed_login:
            raise ToolError("Access denied: this connector is restricted to its owner.")
        return await call_next(context)


def _build_auth() -> tuple[Any, list[Middleware]]:
    """Pick an auth strategy. Priority: GitHub OAuth > static bearer token > none.

    GitHub OAuth is required for the Claude.ai "custom connector" UI, which
    only supports OAuth (no field for a static bearer token). See README.
    """
    if (
        config.GITHUB_OAUTH_CLIENT_ID
        and config.GITHUB_OAUTH_CLIENT_SECRET
        and config.GITHUB_ALLOWED_USERNAME
        and config.PUBLIC_BASE_URL
    ):
        github_auth = GitHubProvider(
            client_id=config.GITHUB_OAUTH_CLIENT_ID,
            client_secret=config.GITHUB_OAUTH_CLIENT_SECRET,
            base_url=config.PUBLIC_BASE_URL,
        )
        return github_auth, [OwnerOnlyMiddleware(config.GITHUB_ALLOWED_USERNAME)]

    if config.MCP_AUTH_TOKEN:
        token_auth = StaticTokenVerifier(
            tokens={
                config.MCP_AUTH_TOKEN: {
                    "client_id": "telegram-mcp-owner",
                    "scopes": ["telegram:read"],
                }
            },
            required_scopes=["telegram:read"],
        )
        return token_auth, []

    return None, []


auth, extra_middleware = _build_auth()

mcp = FastMCP(
    name="telegram-mcp",
    instructions=(
        "Read-only access to the connected Telegram account: list chat "
        "folders, list chats inside a folder, search dialogs, list forum "
        "topics inside a chat, and read recent messages from a chat or a "
        "specific topic within it."
    ),
    auth=auth,
    middleware=extra_middleware,
)


def _title_text(title: Any) -> str:
    """DialogFilter.title is a plain str on older Telethon, TextWithEntities on newer."""
    return title.text if hasattr(title, "text") else str(title)


def _peer_key(peer: Any) -> tuple[str, int] | None:
    if isinstance(peer, InputPeerChannel):
        return ("channel", peer.channel_id)
    if isinstance(peer, InputPeerChat):
        return ("chat", peer.chat_id)
    if isinstance(peer, InputPeerUser):
        return ("user", peer.user_id)
    return None


def _entity_key(entity: Any) -> tuple[str, int] | None:
    if isinstance(entity, Channel):
        return ("channel", entity.id)
    if isinstance(entity, Chat):
        return ("chat", entity.id)
    if isinstance(entity, User):
        return ("user", entity.id)
    return None


def _entity_type(entity: Any) -> str:
    if isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    if isinstance(entity, Chat):
        return "group"
    if isinstance(entity, User):
        return "user"
    return "unknown"


def _dialog_summary(dialog: Any) -> dict[str, Any]:
    entity = dialog.entity
    return {
        "id": dialog.id,
        "title": dialog.name or dialog.title,
        "username": getattr(entity, "username", None),
        "type": _entity_type(entity),
        "unread_count": dialog.unread_count,
    }


async def _get_named_folders() -> list[Any]:
    client = await get_client()
    result = await client(GetDialogFiltersRequest())
    return [f for f in result.filters if isinstance(f, (DialogFilter, DialogFilterChatlist))]


async def _find_folder(folder_title: str) -> Any:
    folders = await _get_named_folders()
    needle = folder_title.strip().lower()

    for f in folders:
        if _title_text(f.title).strip().lower() == needle:
            return f
    for f in folders:
        if needle in _title_text(f.title).strip().lower():
            return f

    available = ", ".join(_title_text(f.title) for f in folders)
    raise ValueError(
        f"No chat folder matching '{folder_title}' found. Available folders: {available}"
    )


async def _resolve_chat(chat: str) -> Any:
    """Resolve a title / @username / numeric id to a dialog entity."""
    client = await get_client()

    if chat.lstrip("-").isdigit():
        return await client.get_entity(int(chat))

    if chat.startswith("@"):
        return await client.get_entity(chat)

    needle = chat.strip().lower()
    dialogs = await client.get_dialogs()

    for d in dialogs:
        if (d.name or "").strip().lower() == needle:
            return d.entity
    for d in dialogs:
        if needle in (d.name or "").strip().lower():
            return d.entity

    raise ValueError(f"No chat found matching '{chat}'.")


async def _list_forum_topics(entity: Any) -> list[Any]:
    client = await get_client()
    result = await client(
        GetForumTopicsRequest(
            peer=entity,
            offset_date=None,
            offset_id=0,
            offset_topic=0,
            limit=100,
        )
    )
    return result.topics


async def _find_topic(entity: Any, topic: str) -> Any:
    topics = await _list_forum_topics(entity)
    needle = topic.strip().lower()

    if topic.isdigit():
        for t in topics:
            if t.id == int(topic):
                return t

    for t in topics:
        if t.title.strip().lower() == needle:
            return t
    for t in topics:
        if needle in t.title.strip().lower():
            return t

    available = ", ".join(t.title for t in topics)
    raise ValueError(f"No topic matching '{topic}' found. Available topics: {available}")


@mcp.tool
async def list_chat_folders() -> list[dict[str, Any]]:
    """List the user's Telegram chat folders (title, id, number of chats included)."""
    folders = await _get_named_folders()
    return [
        {
            "id": f.id,
            "title": _title_text(f.title),
            "chat_count": len(f.include_peers),
        }
        for f in folders
    ]


@mcp.tool
async def list_chats_in_folder(folder_title: str) -> list[dict[str, Any]]:
    """List the chats/channels contained in a Telegram chat folder.

    `folder_title` matches case-insensitively, exact match first then
    substring match (e.g. "불스토리" matches "[7월] 불스토리 구독자 전용방").
    """
    client = await get_client()
    folder = await _find_folder(folder_title)

    wanted_keys = {key for key in (_peer_key(p) for p in folder.include_peers) if key}

    dialogs = await client.get_dialogs()
    by_key = {key: d for d in dialogs if (key := _entity_key(d.entity))}

    chats = []
    for key in wanted_keys:
        dialog = by_key.get(key)
        if dialog is not None:
            chats.append(_dialog_summary(dialog))

    return chats


@mcp.tool
async def list_dialogs(query: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """List (optionally search by title substring) the user's Telegram dialogs.

    Useful for discovering the exact title/username of a chat before calling
    get_recent_messages or get_chat_info.
    """
    client = await get_client()
    dialogs = await client.get_dialogs(limit=None if query else limit)

    if query:
        needle = query.strip().lower()
        dialogs = [d for d in dialogs if needle in (d.name or "").strip().lower()][:limit]

    return [_dialog_summary(d) for d in dialogs]


@mcp.tool
async def get_chat_info(chat: str) -> dict[str, Any]:
    """Get basic info (title, type, username, id) about a chat/channel by title, @username, or id."""
    entity = await _resolve_chat(chat)
    return {
        "id": entity.id,
        "title": getattr(entity, "title", None) or getattr(entity, "first_name", None),
        "username": getattr(entity, "username", None),
        "type": _entity_type(entity),
        "participants_count": getattr(entity, "participants_count", None),
    }


@mcp.tool
async def list_topics(chat: str) -> list[dict[str, Any]]:
    """List forum topics inside a chat, if it has Telegram's "topics" feature enabled.

    Some supergroups split discussion into named topics (e.g. a room might
    contain topics like "차트 스쿨", "공지방", etc.) — those are NOT separate
    dialogs/chats, so list_chats_in_folder/list_dialogs won't show them. Use
    this tool to discover them, then pass the topic title to
    get_recent_messages. Returns an empty list if the chat has no topics.
    """
    entity = await _resolve_chat(chat)
    if not getattr(entity, "forum", False):
        return []

    topics = await _list_forum_topics(entity)
    return [
        {
            "id": t.id,
            "title": t.title,
            "closed": bool(t.closed),
            "pinned": bool(t.pinned),
        }
        for t in topics
    ]


@mcp.tool
async def get_recent_messages(
    chat: str, limit: int = 10, topic: str | None = None
) -> list[dict[str, Any]]:
    """Read the most recent messages from a chat/channel (newest first).

    `chat` may be an exact/partial title, an @username, or a numeric id.
    If the chat has forum topics (see list_topics), pass `topic` (its title
    or id) to read messages from that specific topic instead of the whole
    chat's main/general thread.
    """
    client = await get_client()
    entity = await _resolve_chat(chat)

    reply_to = None
    if topic is not None:
        matched_topic = await _find_topic(entity, topic)
        reply_to = matched_topic.id

    messages = await client.get_messages(entity, limit=limit, reply_to=reply_to)

    result = []
    for m in messages:
        date: datetime | None = m.date
        result.append(
            {
                "id": m.id,
                "date": date.isoformat() if date else None,
                "sender": m.post_author or (str(m.sender_id) if m.sender_id else None),
                "text": m.message or "",
            }
        )
    return result


def main() -> None:
    mcp.run(transport="http", host=config.MCP_HOST, port=config.MCP_PORT)


if __name__ == "__main__":
    main()
