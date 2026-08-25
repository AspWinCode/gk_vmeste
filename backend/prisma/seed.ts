import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Каталог из 9 ролей анкеты «Лист ролей.xlsx» + планировщик — наполняет /api/assistants,
// чтобы assistants.html показывал реальные данные вместо статичной вёрстки.
const assistants = [
  {
    key: "TRANSCRIBER",
    name: "Транскрибатор-референт",
    description: "Загрузка аудио, диаризация по спикерам, саммари, протокол и извлечение поручений с email-рассылкой.",
    inputHint: "mp3, wav, m4a",
    outputHint: "Текст, саммари, задачи, .docx",
    status: "ACTIVE" as const,
    tags: ["Документы", "Аудио", "Саммари"],
  },
  {
    key: "PLANNER",
    name: "Планировщик",
    description: "Формирует поручения, календарные планы, контрольные точки и рабочие сценарии команды.",
    inputHint: "Задачи, даты",
    outputHint: "План, чек-лист",
    status: "ACTIVE" as const,
    tags: ["Планирование", "Сроки", "Поручения"],
  },
  {
    key: "FINANCE_ANALYST",
    name: "Финансовый аналитик",
    description: "Считает ТЭПы, строит финансовую модель и сравнивает сценарии освоения площадки.",
    inputHint: "Параметры проекта",
    outputHint: "Модель, сценарии",
    status: "ACTIVE" as const,
    tags: ["Финансы", "ТЭП", "Финмодель"],
  },
  {
    key: "KSG_CONTROL",
    name: "Контроль КСГ",
    description: "Подсвечивает отставания на текущую дату, фиксирует изменения по календарно-сетевому графику.",
    inputHint: "График, факт",
    outputHint: "Сигналы, отчёт",
    status: "ACTIVE" as const,
    tags: ["Планирование", "КСГ", "Отклонения"],
  },
  {
    key: "LAND_SEARCH",
    name: "Поиск участков и недвижимости",
    description: "Разбирает ссылку/текст объявления об участке или объекте и собирает сводку с рисками.",
    inputHint: "Ссылка или текст объявления",
    outputHint: "Сводка, риски",
    status: "ACTIVE" as const,
    tags: ["Недвижимость", "Публичные данные", "Анализ"],
  },
  {
    key: "SUPPORT_MONITOR",
    name: "Льготы и меры поддержки",
    description: "Разбирает ссылку/текст о мере поддержки и структурирует условия для проверки.",
    inputHint: "Ссылка или текст документа",
    outputHint: "Подборка программ",
    status: "ACTIVE" as const,
    tags: ["Господдержка", "Льготы", "Мониторинг"],
  },
  {
    key: "FINANCE_MONITOR",
    name: "Мониторинг показателей",
    description: "План из финмодели против вручную внесённого факта, сводка по направлениям бизнеса.",
    inputHint: "Факт по проекту (вручную, до 1С)",
    outputHint: "Панель, сигналы",
    status: "ACTIVE" as const,
    tags: ["Финансы", "Дашборд", "KPI"],
  },
  {
    key: "SMM_TELEGRAM",
    name: "СММщик ТГ Аркадий",
    description: "Готовит контент-стратегию на месяц и ежедневные посты в Telegram под актуальную повестку.",
    inputHint: "Тема, повестка",
    outputHint: "Посты, план публикаций",
    status: "SETUP" as const,
    tags: ["Коммуникации", "Контент"],
  },
  {
    key: "SMM_INSTAGRAM",
    name: "СММщик Инста Александр",
    description: "Готовит рилсы на профдеятельность и хобби с озвучкой и монтажом на основе реальных материалов.",
    inputHint: "Фото, видео, бриф",
    outputHint: "Рилсы, сценарии",
    status: "SETUP" as const,
    tags: ["Коммуникации", "Видео"],
  },
  {
    key: "MAIL_PARSER",
    name: "Разборщик почты",
    description: "Вставленное письмо разбирается на приоритет, категорию и явные поручения.",
    inputHint: "Текст письма (без IMAP — вручную)",
    outputHint: "Приоритет, задачи",
    status: "ACTIVE" as const,
    tags: ["Коммуникации", "Почта"],
  },
];

async function main() {
  for (const a of assistants) {
    await prisma.assistant.upsert({ where: { key: a.key }, update: a, create: a });
  }
  console.log(`Каталог ассистентов наполнен: ${assistants.length} записей.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
