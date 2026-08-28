import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env";

const client = new Anthropic({ apiKey: env.anthropicApiKey, baseURL: env.anthropicBaseUrl });

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

const ANALYSIS_TOOL = {
  name: "submit_meeting_analysis",
  description: "Отдать структурированный результат анализа расшифровки.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "Краткое содержание, 3-5 предложений." },
      participants: {
        type: "array",
        items: { type: "string" },
        description: "Участники встречи (имена/роли), если удаётся определить из текста. Пустой массив для диктовки или если участники не называются.",
      },
      subject: {
        type: ["string", "null"],
        description: "Предмет обсуждения одним предложением. null для диктовки.",
      },
      discussionPoints: {
        type: "array",
        items: { type: "string" },
        description: "Что обсуждали — по пунктам, без решений и поручений. Пустой массив для диктовки.",
      },
      decisions: {
        type: "array",
        items: { type: "string" },
        description: "Что решили — конкретно принятые решения (не поручения конкретному человеку, а согласованные позиции). Пустой массив для диктовки.",
      },
      plans: {
        type: "array",
        items: { type: "string" },
        description: "Какие планы наметили на будущее (следующие шаги без привязки к одному ответственному). Пустой массив для диктовки.",
      },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description: "Ключевые тезисы, не попавшие в другие поля.",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            owner: { type: ["string", "null"], description: "Кто ответственный, если назван явно." },
            dueDate: { type: ["string", "null"], description: "ISO 8601 если срок назван явно, иначе null" },
          },
          required: ["title", "owner", "dueDate"],
        },
        description: "Явно поставленные поручения с ответственным и сроком, если названы.",
      },
    },
    required: ["summary", "participants", "subject", "discussionPoints", "decisions", "plans", "keyPoints", "tasks"],
  },
};

// Извлечение саммари/поручений из расшифровки — ядро транскрибатора-референта.
// Шаблон зависит от типа материала: для встречи/звонка/интервью — полный разбор
// (участники, предмет, ход обсуждения, решения, планы, ответственные), для диктовки —
// только краткое содержание, без выдуманных "участников" несуществующей встречи.
export async function analyzeMeetingTranscript(
  transcript: string,
  meetingType: string | null | undefined
): Promise<MeetingAnalysis> {
  const meeting = isMeetingType(meetingType);
  const templateInstruction = meeting
    ? `Это ${meetingType ?? "рабочая встреча"}. Разбери расшифровку по шаблону: кто участники, какой предмет обсуждения, что обсуждали, что решили, какие планы наметили, и отдельно — явные поручения с ответственным и сроком. Не выдумывай участников или решения, которых не было в тексте — если что-то не удаётся определить, оставляй соответствующее поле пустым (для subject — null, для массивов — []).`
    : `Это диктовка одного человека (монолог), не встреча — поэтому участников, "решений совещания" и планов там по определению нет. Заполни только summary и keyPoints (и tasks, если в тексте явно прозвучали поручения самому себе или третьим лицам). Поля participants, subject, discussionPoints, decisions, plans оставь пустыми (subject — null, остальные — []).`;

  const message = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 2500,
    system: `Ты — референт группы компаний "ВМЕСТЕ". ${COMPANY_CONTEXT}\nТебе дают расшифровку аудиозаписи. ${templateInstruction} Не придумывай ответственных и сроки, если они не названы — используй null.`,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "submit_meeting_analysis" },
    messages: [{ role: "user", content: transcript }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude не вернул структурированный результат анализа встречи");
  }
  return toolUse.input as MeetingAnalysis;
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
// панели "Риски и действия" вместо голых цифр.
export async function generateFinanceRiskSummary(scenario: FinanceScenarioForReview): Promise<string> {
  const message = await client.messages.create({
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
