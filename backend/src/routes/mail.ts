import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { analyzeMailText } from "../services/extraction";

export const mailRouter = Router();
mailRouter.use(requireAuth);

const analyzeSchema = z.object({
  subject: z.string().optional(),
  fromAddress: z.string().optional(),
  text: z.string().min(20),
  projectId: z.string().optional(),
});

// POST /api/mail/analyze — разбор ОДНОГО письма, текст которого вставил пользователь
// (переслал себе или скопировал) — см. комментарий в src/services/extraction.ts про
// отсутствие прямого IMAP-доступа к ящику. Сразу сохраняет письмо и извлечённые поручения.
mailRouter.post("/analyze", async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { subject, fromAddress, text, projectId } = parsed.data;

  let analysis;
  try {
    const composed = (subject ? `Тема: ${subject}\n\n` : "") + text;
    analysis = await analyzeMailText(composed);
  } catch (err) {
    return res.status(422).json({ error: err instanceof Error ? err.message : "Не удалось разобрать письмо" });
  }

  const message = await prisma.mailMessage.create({
    data: {
      subject,
      fromAddress,
      rawExcerpt: text.slice(0, 1000),
      summary: analysis.summary,
      priority: analysis.priority,
      category: analysis.category,
    },
  });

  let createdTasks: Awaited<ReturnType<typeof prisma.task.findMany>> = [];
  if (analysis.tasks.length > 0) {
    await prisma.task.createMany({
      data: analysis.tasks.map((t) => ({
        title: t.title,
        description: t.owner ? `Ответственный: ${t.owner}` : undefined,
        dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
        projectId,
        source: `mail:${message.id}`,
      })),
    });
    createdTasks = await prisma.task.findMany({ where: { source: `mail:${message.id}` } });
  }

  res.status(201).json({ message, tasks: createdTasks });
});

// GET /api/mail/messages — история разобранных писем для экрана «Разборщик почты».
mailRouter.get("/messages", async (_req, res) => {
  const messages = await prisma.mailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json(messages);
});
