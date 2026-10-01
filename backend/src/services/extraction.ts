import { XMLParser } from "fast-xml-parser";
import { requestStructuredJson } from "../lib/anthropicClient";

/**
 * Осознанное ограничение: сервис НЕ обходит госторги/ДомРФ/Авито/Циан автоматически —
 * массовый автосбор с этих площадок упирается в антибот-защиту и требует отдельной
 * юридической проверки (см. "Открытые вопросы" в IMPLEMENTATION_PLAN.md). Вместо этого
 * пользователь сам даёт ссылку на конкретное объявление/документ или вставляет текст —
 * это обычный сценарий "проанализируй то, на что я указал", а не скрапинг сайта целиком.
 */
// Базовая защита от SSRF: сервер выполняет fetch по URL, который прислал пользователь
// (объявление/документ). На общем VPS с чужими проектами (Redis, MariaDB, внутренние
// бэкенды на 127.0.0.1/localhost) нельзя пускать туда произвольные хосты — иначе
// авторизованный пользователь этого приложения мог бы прощупывать чужие внутренние сервисы.
// Не защищает от DNS rebinding (для этого нужна проверка резолвленного IP отдельно),
// но отсекает всё очевидное.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, включая облачные metadata-эндпоинты
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
];

function assertSafeUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Поддерживаются только http/https ссылки");
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(url.hostname))) {
    throw new Error("Ссылки на локальные/внутренние адреса не поддерживаются");
  }
  return url;
}

export async function fetchPageText(url: string): Promise<string> {
  const safeUrl = assertSafeUrl(url);
  // redirect:"manual" — не идём по редиректам автоматически (иначе внешний "безопасный" URL
  // мог бы перенаправить на внутренний адрес и обойти проверку выше).
  const res = await fetch(safeUrl, { headers: { "User-Agent": "VmesteAI-Assistant/0.1" }, redirect: "manual" });
  if (!res.ok) throw new Error(`Не удалось загрузить страницу: HTTP ${res.status || "редирект заблокирован"}`);
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

const LAND_JSON_SHAPE = `{
  "title": "короткое название/адрес-ориентир объекта",
  "region": "регион",
  "areaHectares": число_или_null,
  "budgetMillion": "цена/бюджет входа в млн ₽, число или null",
  "riskNotes": "замеченные ограничения, риски или то, что требует проверки"
}`;

export async function extractLandListing(rawText: string): Promise<LandListingExtraction> {
  return requestStructuredJson<LandListingExtraction>({
    maxTokens: 600,
    system:
      "Ты помогаешь девелоперу структурировать объявление о продаже земельного участка или объекта недвижимости. " +
      "Извлеки только то, что явно есть в тексте. Если данных нет — верни null для чисел или короткую пометку в riskNotes, не выдумывай цифры.\n\n" +
      `Ответь СТРОГО валидным JSON без markdown-разметки и без пояснений вокруг, ровно в этой форме:\n${LAND_JSON_SHAPE}`,
    userContent: rawText,
  });
}

export interface MailAnalysis {
  summary: string;
  priority: "высокий" | "средний" | "низкий";
  category: string;
  tasks: { title: string; owner: string | null; dueDate: string | null }[];
}

const MAIL_JSON_SHAPE = `{
  "summary": "суть письма в 1-2 предложениях",
  "priority": "высокий | средний | низкий",
  "category": "например: финансы, стройка, юридическое, коммерческое предложение, спам-рассылка",
  "tasks": [{"title": "поручение", "owner": "ответственный или null", "dueDate": "срок (ISO 8601) или null"}]
}`;

// Разборщик почты: пользователь вставляет текст письма (переслал/скопировал сам —
// без прямого IMAP-доступа к ящику, которого у ассистента нет). Не решаем за человека,
// какие письма читать, только структурируем то, что уже показали.
export async function analyzeMailText(rawEmail: string): Promise<MailAnalysis> {
  return requestStructuredJson<MailAnalysis>({
    maxTokens: 700,
    system:
      'Ты — референт группы компаний "ВМЕСТЕ" (девелопмент, пансионаты МИРРА, розница Nomination). ' +
      "Тебе дают текст письма (тема + содержание). Определи приоритет, категорию и явно поставленные поручения. " +
      "Не придумывай ответственных и сроки, если они не названы — используй null.\n\n" +
      `Ответь СТРОГО валидным JSON без markdown-разметки и без пояснений вокруг, ровно в этой форме:\n${MAIL_JSON_SHAPE}`,
    userContent: rawEmail,
  });
}

export interface SupportProgramExtraction {
  title: string;
  type: string;
  region: string;
  businessLine: string;
  potential: string;
}

const SUPPORT_JSON_SHAPE = `{
  "title": "название меры поддержки",
  "type": "Кредитование / Субсидия / Налоговая льгота / Лизинг / иное",
  "region": "регион",
  "businessLine": "Девелопмент / Пансионаты / Розница — к какому направлению ГК относится",
  "potential": "кратко: в чём практическая польза для группы компаний"
}`;

export async function extractSupportProgram(rawText: string): Promise<SupportProgramExtraction> {
  return requestStructuredJson<SupportProgramExtraction>({
    maxTokens: 500,
    system:
      'Ты помогаешь структурировать найденную меру поддержки бизнеса (льгота, субсидия, кредитная программа) для группы компаний "ВМЕСТЕ" ' +
      "(девелопмент, пансионаты для пожилых МИРРА, розница ювелирных изделий Nomination). Извлеки только то, что явно есть в тексте, не придумывай условия программы.\n\n" +
      `Ответь СТРОГО валидным JSON без markdown-разметки и без пояснений вокруг, ровно в этой форме:\n${SUPPORT_JSON_SHAPE}`,
    userContent: rawText,
  });
}
