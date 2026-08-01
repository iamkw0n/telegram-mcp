"""Read-only MCP server exposing the user's personal Telegram account.

Tools let an MCP client (ChatGPT, Claude, ...) browse Telegram "chat folders",
list the chats/channels inside a folder, search all dialogs, and read the
most recent messages of a chat. Nothing here can send messages or otherwise
mutate the account — the scope is intentionally read-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier
from telethon.tl.functions.messages import GetDialogFiltersRequest
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

auth = StaticTokenVerifier(
    tokens={
        config.MCP_AUTH_TOKEN: {
            "client_id": "telegram-mcp-owner",
            "scopes": ["telegram:read"],
        }
    },
    required_scopes=["telegram:read"],
)

mcp = FastMCP(
    name="telegram-mcp",
    instructions=(
        "Read-only access to the connected Telegram account: list chat "
        "folders, list chats inside a folder, search dialogs, and read "
        "recent messages from a chat or channel."
    ),
    auth=auth,
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
async def get_recent_messages(chat: str, limit: int = 10) -> list[dict[str, Any]]:
    """Read the most recent messages from a chat/channel (newest first).

    `chat` may be an exact/partial title, an @username, or a numeric id.
    """
    client = await get_client()
    entity = await _resolve_chat(chat)

    messages = await client.get_messages(entity, limit=limit)

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
