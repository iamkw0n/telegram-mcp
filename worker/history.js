const HISTORY_RESPONSE_BYTES = 200_000;

export async function collectHistoryPage(source, summarize, limit, beforeMessageId, maxBytes = HISTORY_RESPONSE_BYTES) {
  const messages = [];
  let bytes = 0;
  let hasMore = false;
  const encoder = new TextEncoder();
  for await (const message of source) {
    if (messages.length >= limit) {
      hasMore = true;
      break;
    }
    const item = summarize(message);
    const itemBytes = encoder.encode(JSON.stringify(item)).byteLength;
    if (messages.length && bytes + itemBytes > maxBytes) {
      hasMore = true;
      break;
    }
    messages.push(item);
    bytes += itemBytes;
  }
  return {
    messages,
    count: messages.length,
    has_more: hasMore,
    next_before_message_id: hasMore ? messages.at(-1)?.id ?? beforeMessageId ?? null : null,
  };
}
