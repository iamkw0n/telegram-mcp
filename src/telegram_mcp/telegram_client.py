import asyncio

from telethon import TelegramClient
from telethon.sessions import StringSession

from . import config

_client: TelegramClient | None = None
_lock = asyncio.Lock()


async def get_client() -> TelegramClient:
    """Return a connected, authorized Telethon client (created lazily, reused across calls)."""
    global _client
    async with _lock:
        if _client is None:
            _client = TelegramClient(
                StringSession(config.TG_SESSION_STRING),
                config.TG_API_ID,
                config.TG_API_HASH,
            )
        if not _client.is_connected():
            await _client.connect()
        if not await _client.is_user_authorized():
            raise RuntimeError(
                "Telegram session is not authorized. Re-run scripts/login.py to "
                "generate a fresh TG_SESSION_STRING."
            )
        return _client


async def disconnect_client() -> None:
    global _client
    if _client is not None and _client.is_connected():
        await _client.disconnect()
