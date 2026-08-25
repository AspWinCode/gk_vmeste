import { Router } from "express";
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
  const assistant = await prisma.assistant.findUnique({ where: { key: req.params.key as any } });
  if (!assistant) return res.status(404).json({ error: "Ассистент не найден" });
  res.json(assistant);
});
