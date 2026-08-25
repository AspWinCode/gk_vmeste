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
}

const ANALYSIS_TOOL = {
  name: "submit_meeting_analysis",
  description: "Отдать структурированный результат анализа расшифровки встречи.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "Краткое содержание встречи, 3-5 предложений." },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description: "Ключевые тезисы и решения, без поручений.",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            owner: { type: ["string", "null"] },
            dueDate: { type: ["string", "null"], description: "ISO 8601 если срок назван явно, иначе null" },
          },
          required: ["title", "owner", "dueDate"],
        },
        description: "Явно поставленные поручения с ответственным и сроком, если названы.",
      },
    },
    required: ["summary", "keyPoints", "tasks"],
  },
};

// Извлечение саммари/поручений из расшифровки встречи — ядро транскрибатора-референта.
export async function analyzeMeetingTranscript(transcript: string): Promise<MeetingAnalysis> {
  const message = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 2000,
    system: `Ты — референт группы компаний "ВМЕСТЕ". ${COMPANY_CONTEXT}\nТебе дают расшифровку рабочей встречи. Извлеки краткое содержание, ключевые тезисы и явно поставленные поручения. Не придумывай ответственных и сроки, если они не названы — используй null.`,
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
