import Anthropic from "@anthropic-ai/sdk";
import { XMLParser } from "fast-xml-parser";
import { env } from "../lib/env";

const client = new Anthropic({ apiKey: env.anthropicApiKey, baseURL: env.anthropicBaseUrl });

/**
 * Осознанное ограничение: сервис НЕ обходит госторги/ДомРФ/Авито/Циан автоматически —
 * массовый автосбор с этих площадок упирается в антибот-защиту и требует отдельной
 * юридической проверки (см. "Открытые вопросы" в IMPLEMENTATION_PLAN.md). Вместо этого
 * пользователь сам даёт ссылку на конкретное объявление/документ или вставляет текст —
 * это обычный сценарий "проанализируй то, на что я указал", а не скрапинг сайта целиком.
 */
export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "VmesteAI-Assistant/0.1" } });
  if (!res.ok) throw new Error(`Не удалось загрузить страницу: HTTP ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 15000);
}

/**
 * torgi.gov.ru официально публикует раздел "Открытые данные" (torgi.gov.ru/opendata) —
 * это не скрапинг: обычный GET на документированный XML-фид госплощадки, разрешённый
 * условиями использования сайта. bidKind=2 = "Аренда и продажа земельных участков".
 * URL-схема подтверждена (torgi.gov.ru/opendata/recommendation.html), но точный список
 * XML-тегов лота сайт на момент разработки не отдал (обрыв соединения) — вместо того чтобы
 * гадать с названиями полей, каждый лот целиком (как есть) прогоняется через ту же
 * Claude-экстракцию, что и вставленный вручную текст объявления. Если реальная схема
 * XML отличается от предположений парсера ниже, extractLandListing всё равно вытащит
 * то, что реально нашлось в исходных данных — не жёстко закодированные пути к полям.
 */
const TORGI_OPEN_DATA_URL = "https://torgi.gov.ru/opendata/7710349494-torgi/data.xml";
const TORGI_LAND_BID_KIND = "2";

export interface TorgiLot {
  raw: Record<string, unknown>;
  rawText: string;
}

export async function fetchTorgiLandLots(params: {
  publishDateFrom?: string; // YYYY-MM-DD
  publishDateTo?: string;
  limit?: number;
}): Promise<TorgiLot[]> {
  const url = new URL(TORGI_OPEN_DATA_URL);
  url.searchParams.set("bidKind", TORGI_LAND_BID_KIND);
  if (params.publishDateFrom) url.searchParams.set("publishDateFrom", params.publishDateFrom);
  if (params.publishDateTo) url.searchParams.set("publishDateTo", params.publishDateTo);

  const res = await fetch(url.toString(), { headers: { "User-Agent": "VmesteAI-Assistant/0.1" } });
  if (!res.ok) throw new Error(`torgi.gov.ru открытые данные недоступны: HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(xml);

  // Структура реестра у госплощадок обычно "export > ... > lot[]", но без подтверждённой
  // схемы ищем первый массив объектов на разумной глубине, а не жёстко заданный путь.
  function findLotArray(node: unknown, depth: number): unknown[] | null {
    if (depth > 4 || node === null || typeof node !== "object") return null;
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") return value;
      const nested = findLotArray(value, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  const lots = findLotArray(parsed, 0) ?? [];
  const limited = lots.slice(0, params.limit ?? 15);

  return limited.map((lot) => ({
    raw: lot as Record<string, unknown>,
    rawText: JSON.stringify(lot, null, 1).slice(0, 4000),
  }));
}

export interface LandListingExtraction {
  title: string;
  region: string;
  areaHectares: number | null;
  budgetMillion: number | null;
  riskNotes: string;
}

const LAND_TOOL = {
  name: "submit_land_listing",
  description: "Отдать структурированные параметры земельного участка/объекта из текста объявления.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Короткое название/адрес-ориентир объекта." },
      region: { type: "string" },
      areaHectares: { type: ["number", "null"] },
      budgetMillion: { type: ["number", "null"], description: "Цена/бюджет входа в млн ₽, если указана." },
      riskNotes: { type: "string", description: "Замеченные ограничения, риски или то, что требует проверки." },
    },
    required: ["title", "region", "areaHectares", "budgetMillion", "riskNotes"],
  },
};

export async function extractLandListing(rawText: string): Promise<LandListingExtraction> {
  const message = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 600,
    system:
      "Ты помогаешь девелоперу структурировать объявление о продаже земельного участка или объекта недвижимости. " +
      "Извлеки только то, что явно есть в тексте. Если данных нет — верни null для чисел или короткую пометку в riskNotes, не выдумывай цифры.",
    tools: [LAND_TOOL],
    tool_choice: { type: "tool", name: "submit_land_listing" },
    messages: [{ role: "user", content: rawText }],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude не вернул структурированные данные объекта");
  return toolUse.input as LandListingExtraction;
}

export interface MailAnalysis {
  summary: string;
  priority: "высокий" | "средний" | "низкий";
  category: string;
  tasks: { title: string; owner: string | null; dueDate: string | null }[];
}

const MAIL_TOOL = {
  name: "submit_mail_analysis",
  description: "Отдать структурированный разбор письма: приоритет, категория и явные поручения.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "Суть письма в 1-2 предложениях." },
      priority: { type: "string", enum: ["высокий", "средний", "низкий"] },
      category: { type: "string", description: "Например: финансы, стройка, юридическое, коммерческое предложение, спам-рассылка." },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            owner: { type: ["string", "null"] },
            dueDate: { type: ["string", "null"], description: "ISO 8601, если срок назван явно, иначе null" },
          },
          required: ["title", "owner", "dueDate"],
        },
      },
    },
    required: ["summary", "priority", "category", "tasks"],
  },
};

// Разборщик почты: пользователь вставляет текст письма (переслал/скопировал сам —
// без прямого IMAP-доступа к ящику, которого у ассистента нет). Не решаем за человека,
// какие письма читать, только структурируем то, что уже показали.
export async function analyzeMailText(rawEmail: string): Promise<MailAnalysis> {
  const message = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 700,
    system:
      'Ты — референт группы компаний "ВМЕСТЕ" (девелопмент, пансионаты МИРРА, розница Nomination). ' +
      "Тебе дают текст письма (тема + содержание). Определи приоритет, категорию и явно поставленные поручения. " +
      "Не придумывай ответственных и сроки, если они не названы — используй null.",
    tools: [MAIL_TOOL],
    tool_choice: { type: "tool", name: "submit_mail_analysis" },
    messages: [{ role: "user", content: rawEmail }],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude не вернул структурированный разбор письма");
  return toolUse.input as MailAnalysis;
}

export interface SupportProgramExtraction {
  title: string;
  type: string;
  region: string;
  businessLine: string;
  potential: string;
}

const SUPPORT_TOOL = {
  name: "submit_support_program",
  description: "Отдать структурированные параметры меры поддержки/льготы из текста документа или новости.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string" },
      type: { type: "string", description: "Кредитование / Субсидия / Налоговая льгота / Лизинг / иное." },
      region: { type: "string" },
      businessLine: { type: "string", description: "Девелопмент / Пансионаты / Розница — к какому направлению ГК относится." },
      potential: { type: "string", description: "Кратко: в чём практическая польза для группы компаний." },
    },
    required: ["title", "type", "region", "businessLine", "potential"],
  },
};

export async function extractSupportProgram(rawText: string): Promise<SupportProgramExtraction> {
  const message = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 500,
    system:
      'Ты помогаешь структурировать найденную меру поддержки бизнеса (льгота, субсидия, кредитная программа) для группы компаний "ВМЕСТЕ" ' +
      "(девелопмент, пансионаты для пожилых МИРРА, розница ювелирных изделий Nomination). Извлеки только то, что явно есть в тексте, не придумывай условия программы.",
    tools: [SUPPORT_TOOL],
    tool_choice: { type: "tool", name: "submit_support_program" },
    messages: [{ role: "user", content: rawText }],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude не вернул структурированные данные программы");
  return toolUse.input as SupportProgramExtraction;
}
