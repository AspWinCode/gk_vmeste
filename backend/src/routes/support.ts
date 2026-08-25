import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { extractSupportProgram, fetchPageText } from "../services/extraction";

export const supportRouter = Router();
supportRouter.use(requireAuth);

// GET /api/support/programs?region=&businessLine=&type= — экран «Меры поддержки».
supportRouter.get("/programs", async (req, res) => {
  const { region, businessLine, type, status } = req.query;
  const programs = await prisma.supportProgram.findMany({
    where: {
      region: typeof region === "string" ? region : undefined,
      businessLine: typeof businessLine === "string" ? businessLine : undefined,
      type: typeof type === "string" ? type : undefined,
      status: typeof status === "string" ? status : undefined,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(programs);
});

const analyzeSchema = z
  .object({ url: z.string().url().optional(), text: z.string().min(20).optional() })
  .refine((v) => v.url || v.text, { message: "Нужно указать url или text" });

// POST /api/support/programs/analyze — разбор конкретного найденного документа/новости
// о мере поддержки (ссылка или вставленный текст). Черновик для проверки перед сохранением —
// финансовые/налоговые условия программы должны быть подтверждены человеком, не только Claude.
supportRouter.post("/programs/analyze", async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const text = parsed.data.text ?? (await fetchPageText(parsed.data.url!));
    const extraction = await extractSupportProgram(text);
    res.json({ ...extraction, sourceUrl: parsed.data.url ?? null });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Не удалось проанализировать источник" });
  }
});

const createProgramSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  region: z.string().min(1),
  businessLine: z.string().min(1),
  potential: z.string().min(1),
  status: z.string().default("на проверке"),
  sourceUrl: z.string().url().optional(),
  sourceNote: z.string().optional(),
});

supportRouter.post("/programs", async (req, res) => {
  const parsed = createProgramSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const program = await prisma.supportProgram.create({ data: parsed.data });
  res.status(201).json(program);
});

const updateProgramSchema = z.object({ status: z.string().optional() });

supportRouter.patch("/programs/:id", async (req, res) => {
  const parsed = updateProgramSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const program = await prisma.supportProgram.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(program);
});
