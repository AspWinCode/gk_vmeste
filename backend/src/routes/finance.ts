import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { computeScenarioMetrics } from "../services/financeCalc";
import { generateFinanceRiskSummary } from "../services/claude";
import { notify } from "../services/notify";

export const financeRouter = Router();
financeRouter.use(requireAuth);

// GET /api/finance/scenarios?projectId=... — таблица сравнения сценариев на экране аналитика.
financeRouter.get("/scenarios", async (req, res) => {
  const { projectId } = req.query;
  const scenarios = await prisma.financeScenario.findMany({
    where: { projectId: typeof projectId === "string" ? projectId : undefined },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { name: true } } },
  });
  res.json(scenarios);
});

financeRouter.get("/scenarios/:id", async (req, res) => {
  const scenario = await prisma.financeScenario.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { name: true } } },
  });
  if (!scenario) return res.status(404).json({ error: "Сценарий не найден" });
  res.json(scenario);
});

const createScenarioSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  usageType: z.string().default("Жильё"),
  landAreaSqm: z.coerce.number().positive().optional(),
  saleAreaSqm: z.coerce.number().positive(),
  pricePerSqm: z.coerce.number().positive(),
  costPerSqm: z.coerce.number().positive(),
  durationMonths: z.coerce.number().int().positive(),
  floors: z.coerce.number().int().positive().optional(),
  bedsCount: z.coerce.number().int().positive().optional(),
  unitsMix: z.string().optional(),
  comment: z.string().optional(),
  // Явно попросить Claude сгенерировать риск-комментарий (может быть медленно/платно —
  // по умолчанию выключено, включается флагом).
  withAiReview: z.boolean().optional(),
});

// POST /api/finance/scenarios — «Пересчитать модель»: считает ТЭПы и IRR/NPV на бэкенде
// (не хардкод, а формулы из src/services/financeCalc.ts), опционально добавляет риск-комментарий Claude.
financeRouter.post("/scenarios", async (req, res) => {
  const parsed = createScenarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;

  const metrics = computeScenarioMetrics({
    saleAreaSqm: input.saleAreaSqm,
    pricePerSqm: input.pricePerSqm,
    costPerSqm: input.costPerSqm,
    durationMonths: input.durationMonths,
  });

  let aiRiskSummary: string | null = null;
  if (input.withAiReview) {
    try {
      aiRiskSummary = await generateFinanceRiskSummary({
        usageType: input.usageType,
        saleAreaSqm: input.saleAreaSqm,
        pricePerSqm: input.pricePerSqm,
        costPerSqm: input.costPerSqm,
        durationMonths: input.durationMonths,
        revenue: metrics.revenue,
        costs: metrics.costs,
        margin: metrics.margin,
        irr: metrics.irr,
        npv: metrics.npv,
        paybackMonths: metrics.paybackMonths,
      });
    } catch (err) {
      console.error("[finance] не удалось получить риск-комментарий Claude:", err);
    }
  }

  const scenario = await prisma.financeScenario.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      usageType: input.usageType,
      landAreaSqm: input.landAreaSqm,
      saleAreaSqm: input.saleAreaSqm,
      pricePerSqm: input.pricePerSqm,
      costPerSqm: input.costPerSqm,
      durationMonths: input.durationMonths,
      floors: input.floors,
      bedsCount: input.bedsCount,
      unitsMix: input.unitsMix,
      comment: input.comment,
      revenue: metrics.revenue,
      costs: metrics.costs,
      margin: metrics.margin,
      irr: metrics.irr,
      npv: metrics.npv,
      paybackMonths: metrics.paybackMonths,
      aiRiskSummary,
    },
    include: { project: { select: { name: true } } },
  });

  if (metrics.margin < 0.15) {
    await notify({
      title: "Финсценарий ниже целевой маржи",
      body: `«${scenario.name}» (${scenario.project?.name ?? "проект"}) — маржа ${(metrics.margin * 100).toFixed(1)}%.`,
      type: "finance",
      link: "finance.html",
    });
  }

  res.status(201).json(scenario);
});

// POST /api/finance/scenarios/:id/ai-review — досчитать риск-комментарий отдельно,
// если при создании сценария его не запрашивали.
financeRouter.post("/scenarios/:id/ai-review", async (req, res) => {
  const scenario = await prisma.financeScenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) return res.status(404).json({ error: "Сценарий не найден" });

  let aiRiskSummary: string;
  try {
    aiRiskSummary = await generateFinanceRiskSummary({
      usageType: scenario.usageType,
      saleAreaSqm: scenario.saleAreaSqm ?? 0,
      pricePerSqm: scenario.pricePerSqm ?? 0,
      costPerSqm: scenario.costPerSqm ?? 0,
      durationMonths: scenario.durationMonths ?? 0,
      revenue: scenario.revenue ?? 0,
      costs: scenario.costs ?? 0,
      margin: scenario.margin ?? 0,
      irr: scenario.irr,
      npv: scenario.npv ?? 0,
      paybackMonths: scenario.paybackMonths,
    });
  } catch (err) {
    console.error("[finance] ai-review не удался:", err);
    return res.status(502).json({
      error: "Не удалось получить оценку рисков от Claude — проверьте ANTHROPIC_API_KEY в .env на сервере.",
    });
  }

  const updated = await prisma.financeScenario.update({
    where: { id: scenario.id },
    data: { aiRiskSummary },
  });
  res.json(updated);
});
