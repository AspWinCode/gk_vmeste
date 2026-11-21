// Публикация в Telegram-канал через обычный Bot API (без сторонних SDK — всего два
// метода нужны). Бот должен быть добавлен в канал админом с правом публикации постов,
// см. инструкцию в frontend/settings.html — иначе sendMessage вернёт понятную ошибку
// Telegram вида "Forbidden: bot is not a member of the channel chat".

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callTelegramApi<T>(botToken: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(data.description || `Telegram API (${method}) вернул ошибку без описания`);
  }
  return data.result as T;
}

// Проверка токена при подключении канала в Настройках — getMe не требует прав в
// конкретном чате, просто подтверждает, что токен валиден и возвращает имя бота для
// отображения (чтобы администратор видел, какого именно бота он подключил).
export async function verifyTelegramBot(botToken: string): Promise<{ username: string }> {
  const me = await callTelegramApi<{ username?: string }>(botToken, "getMe");
  return { username: me.username || "" };
}

export async function sendTelegramMessage(botToken: string, channelId: string, text: string): Promise<void> {
  await callTelegramApi(botToken, "sendMessage", { chat_id: channelId, text });
}
