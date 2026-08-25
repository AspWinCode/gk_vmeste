import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const financeMonitorRouter = Router();
financeMonitorRouter.use(requireAuth);

function statusFor(planRevenue: number, actualRevenue: number): string {
  if (planRevenue <= 0) return "нет плана";
  const deltaShare = (actualRevenue - planRevenue) / planRevenue;
  if (deltaShare >= 0.02) return "выше плана";
  if (deltaShare >= -0.05) return "по плану";
  if (deltaShare >= -0.15) return "внимание";
  return "риск";
}

// GET /api/finance-monitor/summary — «Мониторинг финансовых показателей»: план (последний
// FinanceScenario по проекту) против факта (последний FinancialActual), собранных в один
// дашборд. Пока факт вносится вручную/из Excel — см. комментарий к модели в schema.prisma.
financeMonitorRouter.get("/summary", async (_req, res) => {
  const projects = await prisma.project.findMany({
    include: {
      financeScenarios: { orderBy: { createdAt: "desc" }, take: 1 },
      financialActuals: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const rows = projects.map((p) => {
    const plan = p.financeScenarios[0];
    const actual = p.financialActuals[0];
    const planRevenue = plan?.revenue ?? 0;
    const actualRevenue = actual?.actualRevenue ?? null;
    const deviation = actualRevenue !== null ? actualRevenue - planRevenue : null;
    return {
      projectId: p.id,
      projectName: p.name,
      businessLine: p.businessLine,
      planRevenue: plan ? planRevenue : null,
      planMargin: plan?.margin ?? null,
      actualRevenue,
      actualMargin: actual?.actualMargin ?? null,
      periodLabel: actual?.periodLabel ?? null,
      deviation,
      status: actualRevenue !== null ? statusFor(planRevenue, actualRevenue) : "нет факта",
    };
  });

  const withActuals = rows.filter((r) => r.actualRevenue !== null);
  const totalRevenue = withActuals.reduce((sum, r) => sum + (r.actualRevenue ?? 0), 0);
  const totalMarginIncome = withActuals.reduce(
    (sum, r) => sum + (r.actualRevenue ?? 0) * (r.actualMargin ?? 0),
    0
  );
  const avgMargin = totalRevenue > 0 ? totalMarginIncome / totalRevenue : null;
  const deviatingProjects = withActuals.filter((r) => r.status === "внимание" || r.status === "риск").length;

  const byBusinessLine = new Map<string, { revenue: number; marginIncome: number }>();
  withActuals.forEach((r) => {
    const entry = byBusinessLine.get(r.businessLine) ?? { revenue: 0, marginIncome: 0 };
    entry.revenue += r.actualRevenue ?? 0;
    entry.marginIncome += (r.actualRevenue ?? 0) * (r.actualMargin ?? 0);
    byBusinessLine.set(r.businessLine, entry);
  });

  res.json({
    rows,
    totals: {
      totalRevenue,
      totalMarginIncome,
      avgMargin,
      deviatingProjects,
    },
    byBusinessLine: Array.from(byBusinessLine.entries()).map(([businessLine, v]) => ({
      businessLine,
      revenue: v.revenue,
      avgMargin: v.revenue > 0 ? v.marginIncome / v.revenue : null,
    })),
  });
});

const createActualSchema = z.object({
  projectId: z.string(),
  periodLabel: z.string().min(1),
  actualRevenue: z.coerce.number(),
  actualMargin: z.coerce.number().optional(),
  comment: z.string().optional(),
});

financeMonitorRouter.post("/actuals", async (req, res) => {
  const parsed = createActualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const actual = await prisma.financialActual.create({ data: parsed.data });
  res.status(201).json(actual);
});

financeMonitorRouter.get("/actuals", async (req, res) => {
  const { projectId } = req.query;
  const actuals = await prisma.financialActual.findMany({
    where: { projectId: typeof projectId === "string" ? projectId : undefined },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { name: true } } },
  });
  res.json(actuals);
});
