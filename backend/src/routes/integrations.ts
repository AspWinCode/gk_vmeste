import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { verifyTelegramBot } from "../services/telegram";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

// Токен боту не нужно светить в интерфейсе целиком — ни на фронте, ни в логах. Маска
// оставляет только края, достаточно, чтобы узнать "тот ли это бот", не больше.
function maskToken(token: string): string {
  return token.length <= 8 ? "••••" : token.slice(0, 4) + "…" + token.slice(-4);
}

// GET /api/integrations — какие каналы уже подключены (для экрана "Настройки").
// Аккаунт один на всех (см. комментарий в schema.prisma у модели Integration),
// поэтому список, а не "мои интеграции".
integrationsRouter.get("/", async (_req, res) => {
  const rows = await prisma.integration.findMany();
  res.json(
    rows.map((r) => {
      const config = r.config as Record<string, string>;
      return {
        type: r.type,
        channelId: config.channelId,
        botUsername: config.botUsername,
        botTokenMasked: config.botToken ? maskToken(config.botToken) : undefined,
      };
    })
  );
});

const telegramSchema = z.object({
  botToken: z.string().min(10, "Похоже, это не токен бота"),
  channelId: z.string().min(1, "Укажите ID или @username канала"),
});

// POST /api/integrations/telegram — подключение/обновление канала. Токен проверяется
// реальным запросом к Telegram (getMe) до сохранения — иначе кривой токен молча лежал
// бы в базе до первой попытки публикации.
integrationsRouter.post("/telegram", async (req, res) => {
  const parsed = telegramSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let botUsername: string;
  try {
    botUsername = (await verifyTelegramBot(parsed.data.botToken)).username;
  } catch (err) {
    return res.status(400).json({ error: "Не удалось проверить токен бота: " + (err instanceof Error ? err.message : String(err)) });
  }

  const config = { botToken: parsed.data.botToken, channelId: parsed.data.channelId, botUsername };
  await prisma.integration.upsert({
    where: { type: "TELEGRAM" },
    create: { type: "TELEGRAM", config },
    update: { config },
  });

  res.status(201).json({ type: "TELEGRAM", channelId: config.channelId, botUsername, botTokenMasked: maskToken(config.botToken) });
});

// DELETE /api/integrations/:type — отключить канал (например, чтобы переподключить
// с другим ботом/токеном).
integrationsRouter.delete("/:type", async (req, res) => {
  await prisma.integration.deleteMany({ where: { type: req.params.type.toUpperCase() } });
  res.status(204).end();
});
