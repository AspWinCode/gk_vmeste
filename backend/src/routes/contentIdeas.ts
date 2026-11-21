import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { sendTelegramMessage } from "../services/telegram";

export const contentIdeasRouter = Router();
contentIdeasRouter.use(requireAuth);

// GET /api/content-ideas — контент-план СММщика: темы постов/рилсов, которые Claude
// извлёк из расшифровок встреч (см. generateContentIdeas в services/claude.ts,
// заполняется воркером после обработки каждой записи).
contentIdeasRouter.get("/", async (_req, res) => {
  const ideas = await prisma.contentIdea.findMany({
    orderBy: { createdAt: "desc" },
    include: { job: { select: { id: true, audioFileName: true, subject: true, createdAt: true } } },
  });
  res.json(ideas);
});

const updateSchema = z.object({ published: z.boolean() });

// PATCH /api/content-ideas/:id — чекбокс "выложили" в таблице контент-плана.
contentIdeasRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.contentIdea.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Тема не найдена" });

  const idea = await prisma.contentIdea.update({
    where: { id: req.params.id },
    data: { published: parsed.data.published },
  });
  res.json(idea);
});

// POST /api/content-ideas/:id/publish — кнопка "Опубликовать" в таблице контент-плана.
// Только Telegram пока (см. Integration.type) — Instagram Graph API требует картинку/видео
// на каждый пост, а тема контент-плана сейчас это просто заголовок+текст.
contentIdeasRouter.post("/:id/publish", async (req, res) => {
  const idea = await prisma.contentIdea.findUnique({ where: { id: req.params.id } });
  if (!idea) return res.status(404).json({ error: "Тема не найдена" });

  const integration = await prisma.integration.findUnique({ where: { type: "TELEGRAM" } });
  if (!integration) return res.status(409).json({ error: "Telegram не подключён — настройте канал в Настройках → Интеграции." });

  const config = integration.config as { botToken: string; channelId: string };
  // Без markdown-разметки намеренно — parse_mode у Telegram валит весь запрос, если в
  // заголовке/тексте случайно встретится "_"/"*"/другой спецсимвол разметки, который
  // никто не экранировал; обычный текст работает всегда.
  const text = `${idea.title}\n\n${idea.topic}`;
  try {
    await sendTelegramMessage(config.botToken, config.channelId, text);
  } catch (err) {
    return res.status(502).json({ error: "Не удалось отправить в Telegram: " + (err instanceof Error ? err.message : String(err)) });
  }

  const updated = await prisma.contentIdea.update({ where: { id: idea.id }, data: { published: true } });
  res.json(updated);
});
