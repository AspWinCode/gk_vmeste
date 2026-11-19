import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

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
