import { env } from "@/lib/env";

type TelegramResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { username?: string };
  };
};

function describeError(error: unknown) {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error
        ? ` (${error.cause.message})`
        : typeof error.cause === "string"
          ? ` (${error.cause})`
          : "";
    return `${error.message}${cause}`.trim();
  }

  return String(error);
}

async function telegramRequest<T>(method: string, body?: Record<string, unknown>) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram bot token is not configured.");
  }

  const apiBaseUrl = env.TELEGRAM_API_BASE_URL.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`Telegram request to ${apiBaseUrl}/${method} failed: ${describeError(error)}`);
  }

  let payload: TelegramResponse<T>;
  try {
    payload = (await response.json()) as TelegramResponse<T>;
  } catch (error) {
    throw new Error(`Telegram response from ${apiBaseUrl}/${method} could not be parsed: ${describeError(error)}`);
  }
  if (!response.ok) {
    throw new Error(payload.description || `Telegram request failed with status ${response.status}.`);
  }

  if (!payload.ok) {
    throw new Error(payload.description || "Telegram API returned an unsuccessful response.");
  }

  return payload.result;
}

function splitTelegramMessage(text: string, maxLength = 3500) {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let buffer = "";

  for (const line of text.split("\n")) {
    const nextChunk = buffer ? `${buffer}\n${line}` : line;
    if (nextChunk.length <= maxLength) {
      buffer = nextChunk;
      continue;
    }

    if (buffer) {
      parts.push(buffer);
    }

    if (line.length <= maxLength) {
      buffer = line;
      continue;
    }

    for (let index = 0; index < line.length; index += maxLength) {
      parts.push(line.slice(index, index + maxLength));
    }
    buffer = "";
  }

  if (buffer) {
    parts.push(buffer);
  }

  return parts;
}

export async function resolveTelegramChatIdByUsername(username: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const cleanUsername = username.replace("@", "").toLowerCase();
  const updates = await telegramRequest<TelegramUpdate[]>("getUpdates");
  const match = updates.find(
    (entry) => entry.message?.from?.username?.replace("@", "").toLowerCase() === cleanUsername,
  );

  return match?.message?.chat.id ? String(match.message.chat.id) : null;
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram bot token is not configured on the server.");
  }

  const normalizedChatIds = Array.from(
    new Set(
      chatId
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
  if (!normalizedChatIds.length) {
    throw new Error("Telegram chat ID is empty.");
  }

  const parts = splitTelegramMessage(text.trim());
  const errors: Error[] = [];
  let deliveredCount = 0;

  for (const normalizedChatId of normalizedChatIds) {
    try {
      for (const part of parts) {
        await telegramRequest("sendMessage", {
          chat_id: normalizedChatId,
          text: part,
          disable_web_page_preview: true,
        });
      }
      deliveredCount += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(describeError(error)));
    }
  }

  if (!deliveredCount) {
    const details = errors.slice(0, 3).map((error) => error.message).join(" | ");
    throw new AggregateError(
      errors,
      details ? `Telegram delivery failed for all recipients: ${details}` : "Telegram delivery failed for all recipients.",
    );
  }

  return { delivered: true, deliveredCount, failedCount: errors.length };
}
