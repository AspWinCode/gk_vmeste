import { anthropicClient, requestStructuredJson } from "../lib/anthropicClient";
import { env } from "../lib/env";

const COMPANY_CONTEXT = `Мы группа компаний, объединяющих три направления деятельности:
ГК ВМЕСТЕ — девелопмент в Иркутской области;
МИРРА — сеть пансионатов для пожилых людей в Иркутской области;
Nomination — розничная сеть итальянских ювелирных украшений в Иркутске, Красноярске и Москве.`;

export interface MeetingAnalysis {
  summary: string;
  keyPoints: string[];
  tasks: { title: string; owner: string | null; dueDate: string | null }[];
  // Заполняются только для "встречных" типов (см. isMeetingType ниже) — для Диктовки
  // Claude намеренно оставляет их пустыми, там достаточно summary/keyPoints.
  participants: string[];
  subject: string | null;
  discussionPoints: string[];
  decisions: string[];
  plans: string[];
}

// Диктовка — монолог одного человека, там нет "участников" и "решений совещания" по
// определению. Всё остальное (Совещание/Интервью/Звонок/не указано) разбирается по
// полному шаблону встречи — см. системный промпт в analyzeMeetingTranscript.
function isMeetingType(meetingType: string | null | undefined): boolean {
  return meetingType !== "Диктовка";
}

const ANALYSIS_JSON_SHAPE = `{
  "summary": "краткое содержание, 3-5 предложений",
  "participants": ["участники встречи (имена/роли), если определяются из текста — иначе []"],
  "subject": "предмет обсуждения одним предложением, или null",
  "discussionPoints": ["что обсуждали — по пунктам, без решений и поручений"],
  "decisions": ["что решили — согласованные позиции, не поручения конкретному человеку"],
  "plans": ["какие планы наметили на будущее"],
  "keyPoints": ["ключевые тезисы, не попавшие в другие поля"],
  "tasks": [{"title": "поручение", "owner": "ответственный или null", "dueDate": "срок (ISO 8601) или null"}]
}`;

// Извлечение саммари/поручений из расшифровки — ядро транскрибатора-референта.
// Шаблон зависит от типа материала: для встречи/звонка/интервью — полный разбор
// (участники, предмет, ход обсуждения, решения, планы, ответственные), для диктовки —
// только краткое содержание, без выдуманных "участников" несуществующей встречи.
//
// Отвечает обычным текстовым JSON, не через tools/tool_choice — см. комментарий в
// lib/anthropicClient.ts про баг прокси AI Tunnel на форсированном tool_choice.
export async function analyzeMeetingTranscript(
  transcript: string,
  meetingType: string | null | undefined
): Promise<MeetingAnalysis> {
  const meeting = isMeetingType(meetingType);
  const templateInstruction = meeting
    ? `Это ${meetingType ?? "рабочая встреча"}. Разбери расшифровку по шаблону: кто участники, какой предмет обсуждения, что обсуждали, что решили, какие планы наметили, и отдельно — явные поручения с ответственным и сроком. Не выдумывай участников или решения, которых не было в тексте — если что-то не удаётся определить, оставляй соответствующее поле пустым (для subject — null, для массивов — []).`
    : `Это диктовка одного человека (монолог), не встреча — поэтому участников, "решений совещания" и планов там по определению нет. Заполни только summary и keyPoints (и tasks, если в тексте явно прозвучали поручения самому себе или третьим лицам). Поля participants, subject, discussionPoints, decisions, plans оставь пустыми (subject — null, остальные — []).`;

  // 8000, не 2500 — AI Tunnel на части запросов сам включает "размышление" (extended
  // thinking), которого мы не просили и управлять им не можем; на реальной расшифровке
  // оно съело весь max_tokens=2500 до единого токена вывода, оставив только thinking-блок
  // без текста (stop_reason=max_tokens). С 8000 thinking (~1400 токенов на том же тексте)
  // и сам JSON-ответ помещаются оба. max_tokens — это потолок, не плата: лишний запас
  // ничего не стоит, пока реально не используется.
  const raw = await requestStructuredJson<Partial<MeetingAnalysis>>({
    maxTokens: 8000,
    system: `Ты — референт группы компаний "ВМЕСТЕ". ${COMPANY_CONTEXT}\nТебе дают расшифровку аудиозаписи. ${templateInstruction} Не придумывай ответственных и сроки, если они не названы — используй null.\n\nОтветь СТРОГО валидным JSON без markdown-разметки и без пояснений вокруг, ровно в этой форме:\n${ANALYSIS_JSON_SHAPE}`,
    userContent: transcript,
  });

  // Даже обычный текстовый JSON не гарантирует железно, что модель заполнит каждое поле —
  // на сложной/несвязной расшифровке Claude иногда пропускает одно из них целиком. Без
  // дефолтов это роняет worker на `analysis.tasks.length` и подобном.
  return {
    summary: raw.summary ?? "",
    keyPoints: raw.keyPoints ?? [],
    tasks: raw.tasks ?? [],
    participants: raw.participants ?? [],
    subject: raw.subject ?? null,
    discussionPoints: raw.discussionPoints ?? [],
    decisions: raw.decisions ?? [],
    plans: raw.plans ?? [],
  };
}

export interface FinanceScenarioForReview {
  usageType: string;
  saleAreaSqm: number;
  pricePerSqm: number;
  costPerSqm: number;
  durationMonths: number;
  revenue: number;
  costs: number;
  margin: number;
  irr: number | null;
  npv: number;
  paybackMonths: number | null;
}

// Короткий риск-комментарий к рассчитанному сценарию — то, что аналитик видит в
// панели "Риски и действия" вместо голых цифр. Обычный текстовый ответ, structured
// JSON тут не нужен — tools/tool_choice не используются изначально.
export async function generateFinanceRiskSummary(scenario: FinanceScenarioForReview): Promise<string> {
  const message = await anthropicClient.messages.create({
    model: env.anthropicModel,
    max_tokens: 500,
    system: `Ты — финансовый аналитик группы компаний "ВМЕСТЕ". ${COMPANY_CONTEXT}\nТебе дают рассчитанные ТЭПы и метрики сценария освоения площадки. Дай короткий (3-5 предложений) комментарий: устойчивость сценария, к чему он наиболее чувствителен (цена/сроки/затраты), и что стоит проверить перед принятием решения. Пиши по-деловому, без вводных фраз.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify(scenario, null, 2),
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}
