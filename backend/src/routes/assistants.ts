import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const assistantsRouter = Router();

assistantsRouter.use(requireAuth);

// GET /api/assistants — витрина каталога, наполняет assistants.html вместо статичной разметки.
assistantsRouter.get("/", async (_req, res) => {
  const assistants = await prisma.assistant.findMany({ orderBy: { createdAt: "asc" } });
  res.json(assistants);
});

assistantsRouter.get("/:key", async (req, res) => {
  const assistant = await prisma.assistant.findUnique({ where: { key: req.params.key } });
  if (!assistant) return res.status(404).json({ error: "Ассистент не найден" });
  res.json(assistant);
});

function slugify(name: string): string {
  return (
    "custom_" +
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) +
    "_" +
    Date.now().toString(36)
  );
}

const createAssistantSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputHint: z.string().min(1),
  outputHint: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

// POST /api/assistants — "Добавить ассистента" в каталоге. Заносит новую роль/сценарий
// в реестр со статусом NEW — это карточка-заявка на будущий модуль, а не обещание,
// что за ней уже стоит рабочий экран (в отличие от builtIn-модулей).
assistantsRouter.post("/", async (req, res) => {
  const parsed = createAssistantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const assistant = await prisma.assistant.create({
    data: { ...parsed.data, key: slugify(parsed.data.name), status: "NEW", builtIn: false },
  });
  res.status(201).json(assistant);
});

const updateAssistantSchema = z.object({
  status: z.enum(["ACTIVE", "SETUP", "NEW"]).optional(),
  description: z.string().min(1).optional(),
});

assistantsRouter.patch("/:id", async (req, res) => {
  const parsed = updateAssistantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const assistant = await prisma.assistant.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(assistant);
});

assistantsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.assistant.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Ассистент не найден" });
  if (existing.builtIn) return res.status(400).json({ error: "Встроенный модуль нельзя удалить из каталога" });
  await prisma.assistant.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
