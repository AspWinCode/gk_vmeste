import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { extractLandListing, fetchPageText, fetchTorgiLandLots } from "../services/extraction";

export const landRouter = Router();
landRouter.use(requireAuth);

// GET /api/land/objects?profile=Девелопмент|МИРРА&status=... — экран «Земля и объекты».
landRouter.get("/objects", async (req, res) => {
  const { profile, status, projectId } = req.query;
  const objects = await prisma.landObject.findMany({
    where: {
      profile: typeof profile === "string" ? profile : undefined,
      status: typeof status === "string" ? status : undefined,
      projectId: typeof projectId === "string" ? projectId : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { name: true } } },
  });
  res.json(objects);
});

const analyzeSchema = z
  .object({ url: z.string().url().optional(), text: z.string().min(20).optional() })
  .refine((v) => v.url || v.text, { message: "Нужно указать url или text" });

// POST /api/land/objects/analyze — разбор ОДНОГО объявления/страницы, на которую указал
// пользователь (ссылка или вставленный текст). Не массовый обход площадок — см. комментарий
// в src/services/extraction.ts. Возвращает черновик для проверки, ничего не сохраняет.
landRouter.post("/objects/analyze", async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const text = parsed.data.text ?? (await fetchPageText(parsed.data.url!));
    const extraction = await extractLandListing(text);
    res.json({ ...extraction, sourceUrl: parsed.data.url ?? null });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Не удалось проанализировать источник" });
  }
});

const torgiSearchSchema = z.object({
  publishDateFrom: z.string().optional(),
  publishDateTo: z.string().optional(),
  limit: z.coerce.number().int().positive().max(30).optional(),
});

// POST /api/land/objects/search-torgi — легальный автоматический источник: официальные
// открытые данные torgi.gov.ru (аренда/продажа земельных участков), не скрапинг и не
// обход защиты. Каждый лот прогоняется через ту же Claude-экстракцию, что и ручной ввод —
// см. комментарий в src/services/extraction.ts про неподтверждённую XML-схему. Ничего не
// сохраняется автоматически, только черновики на проверку.
landRouter.post("/objects/search-torgi", async (req, res) => {
  const parsed = torgiSearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const lots = await fetchTorgiLandLots(parsed.data);
    if (lots.length === 0) {
      return res.json({ results: [], note: "Открытые данные вернули 0 лотов за выбранный период — проверьте даты или увеличьте диапазон." });
    }
    const results = await Promise.all(
      lots.map(async (lot) => {
        try {
          const extraction = await extractLandListing(lot.rawText);
          return { ...extraction, source: "torgi.gov.ru", rawPreview: lot.rawText.slice(0, 500) };
        } catch {
          return { title: "(не удалось разобрать)", region: "", areaHectares: null, budgetMillion: null, riskNotes: "Claude не смог структурировать этот лот", source: "torgi.gov.ru", rawPreview: lot.rawText.slice(0, 500) };
        }
      })
    );
    res.json({ results });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Не удалось получить данные torgi.gov.ru" });
  }
});

const createObjectSchema = z.object({
  title: z.string().min(1),
  region: z.string().min(1),
  profile: z.enum(["Девелопмент", "МИРРА"]).default("Девелопмент"),
  areaHectares: z.coerce.number().positive().optional(),
  budgetMillion: z.coerce.number().positive().optional(),
  status: z.string().default("первичный скрининг"),
  source: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  riskNotes: z.string().optional(),
  projectId: z.string().optional(),
});

landRouter.post("/objects", async (req, res) => {
  const parsed = createObjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const object = await prisma.landObject.create({ data: parsed.data });
  res.status(201).json(object);
});

const updateObjectSchema = z.object({
  status: z.string().optional(),
  riskNotes: z.string().optional(),
});

landRouter.patch("/objects/:id", async (req, res) => {
  const parsed = updateObjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const object = await prisma.landObject.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(object);
});
