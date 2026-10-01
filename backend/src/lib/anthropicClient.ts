import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// apiKey: null обязателен — иначе конструктор SDK сам подхватывает ANTHROPIC_API_KEY из
// process.env (свой встроенный дефолт параметра конструктора, не наш env.ts) и тогда всегда
// предпочитает x-api-key authToken'у — Bearer-заголовок тихо не уходит. Нужно для прокси вроде
// AI Tunnel, которые проверяют именно Authorization: Bearer; настоящий api.anthropic.com
// принимает оба варианта одинаково, так что это безопасно и без прокси.
export const anthropicClient = new Anthropic({
  apiKey: null,
  authToken: env.anthropicApiKey,
  baseURL: env.anthropicBaseUrl,
});

function stripJsonFence(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Структурированный JSON-ответ ОБЫЧНЫМ текстом, без tools/tool_choice.
 *
 * Намеренно не используем форсированный tool_choice: на проде через AI Tunnel он ломается
 * на длинных/многополевых схемах — модель генерирует валидный tool_use, но прокси коверкает
 * JSON при трансляции в свой внутренний формат (в реальном ответе видели буквальные
 * `</parameter><parameter name="...">` внутри строковых полей — соседние поля наезжали друг
 * на друга и часть данных терялась). Проверено на той же инфраструктуре: обычный текстовый
 * ответ с просьбой вернуть JSON отрабатывает надёжно даже на длинном и сложном вводе.
 */
export async function requestStructuredJson<T>(opts: {
  system: string;
  userContent: string;
  maxTokens: number;
}): Promise<T> {
  const message = await anthropicClient.messages.create({
    model: env.anthropicModel,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.userContent }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude не вернул текстовый ответ");
  }

  const unwrapped = stripJsonFence(textBlock.text.trim());
  try {
    return JSON.parse(unwrapped) as T;
  } catch {
    // Модель иногда добавляет пояснение до/после JSON, несмотря на инструкцию не делать
    // этого — последняя попытка вытащить первый {...} блок, а не падать сразу.
    const match = unwrapped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // падаем ниже с полным текстом в ошибке
      }
    }
    throw new Error("Claude вернул невалидный JSON: " + unwrapped.slice(0, 500));
  }
}
