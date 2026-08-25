import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { buildDailyReportDocx } from "../services/dailyReport";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const reportSchema = z.object({
  kpis: z.array(z.object({ label: z.string(), value: z.string() })),
  signals: z.array(z.object({ title: z.string(), text: z.string(), label: z.string() })),
  projects: z.array(z.object({ name: z.string(), note: z.string(), status: z.string() })),
  tasks: z.array(z.object({ title: z.string(), due: z.string() })),
});

// POST /api/reports/daily-summary — кнопка "Сформировать отчёт" на рабочем столе:
// то, что уже посчитано и показано на экране, оформляется в .docx для скачивания/пересылки.
reportsRouter.post("/daily-summary", async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const filePath = await buildDailyReportDocx(parsed.data);
  res.download(filePath, "svodka-rukovoditelya.docx");
});
