import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { notify } from "../services/notify";
import { requireAuth } from "../middleware/auth";

export const ksgRouter = Router();
ksgRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function computeStatus(deviationDays: number): string {
  if (deviationDays <= 0) return "по плану";
  if (deviationDays <= 3) return "контроль";
  if (deviationDays <= 7) return "внимание";
  return "критично";
}

// Если факта ещё нет, но плановая дата уже прошла — этап реально просрочен, а не "по плану".
// deviationDays у стадии без факта хранится нулём с момента создания и не обновляется сам
// по себе с течением времени, поэтому здесь считаем "на сейчас", а не полагаемся на кэш в БД.
function deviationInDays(plan: Date, fact: Date | null): number {
  if (fact) return Math.round((fact.getTime() - plan.getTime()) / (1000 * 60 * 60 * 24));
  const today = new Date();
  if (today <= plan) return 0;
  return Math.round((today.getTime() - plan.getTime()) / (1000 * 60 * 60 * 24));
}

// Пересчитывает отклонение/статус "на сейчас" для этапов без факта — иначе просроченный,
// но не отмеченный вручную этап так и висел бы вечно со статусом "по плану".
function withLiveDeviation<T extends { planDate: Date; factDate: Date | null; deviationDays: number; status: string }>(
  stage: T
): T {
  if (stage.factDate) return stage;
  const deviationDays = deviationInDays(stage.planDate, null);
  if (deviationDays === stage.deviationDays) return stage;
  return { ...stage, deviationDays, status: computeStatus(deviationDays) };
}

// GET /api/ksg/stages?projectId=... — сводная таблица этапов; без projectId — по всем ~15 проектам.
ksgRouter.get("/stages", async (req, res) => {
  const { projectId, stageType } = req.query;
  const stages = await prisma.ksgStage.findMany({
    where: {
      projectId: typeof projectId === "string" ? projectId : undefined,
      stageType: typeof stageType === "string" ? stageType : undefined,
    },
    orderBy: { planDate: "asc" },
    include: { project: { select: { name: true } } },
  });
  res.json(stages.map(withLiveDeviation));
});

// GET /api/ksg/summary — KPI-карточки на экране «Контроль КСГ»: критические отставания,
// максимальное отклонение, доля актуализированных этапов.
ksgRouter.get("/summary", async (_req, res) => {
  const stages = (await prisma.ksgStage.findMany()).map(withLiveDeviation);
  const total = stages.length;
  const critical = stages.filter((s) => s.status === "критично").length;
  const maxDeviation = stages.reduce((max, s) => Math.max(max, s.deviationDays), 0);
  const updatedRecently = stages.filter(
    (s) => Date.now() - s.updatedAt.getTime() < 7 * 24 * 60 * 60 * 1000
  ).length;

  res.json({
    totalStages: total,
    criticalStages: critical,
    maxDeviationDays: maxDeviation,
    updatedSharePercent: total > 0 ? Math.round((updatedRecently / total) * 100) : 0,
  });
});

const createStageSchema = z.object({
  projectId: z.string(),
  stageType: z.string().min(1),
  name: z.string().min(1),
  planDate: z.string().datetime(),
  factDate: z.string().datetime().optional(),
});

ksgRouter.post("/stages", async (req, res) => {
  const parsed = createStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { planDate, factDate, ...rest } = parsed.data;

  const plan = new Date(planDate);
  const fact = factDate ? new Date(factDate) : null;
  const deviationDays = deviationInDays(plan, fact);

  const stage = await prisma.ksgStage.create({
    data: { ...rest, planDate: plan, factDate: fact, deviationDays, status: computeStatus(deviationDays) },
  });
  res.status(201).json(stage);
});

const updateStageSchema = z.object({
  factDate: z.string().datetime().nullable().optional(),
  name: z.string().min(1).optional(),
});

// PATCH /api/ksg/stages/:id — обычно проставление факта: отклонение и статус
// пересчитываются автоматически, а не вводятся руками.
ksgRouter.patch("/stages/:id", async (req, res) => {
  const parsed = updateStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.ksgStage.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Этап не найден" });

  const fact = parsed.data.factDate === undefined ? existing.factDate : parsed.data.factDate ? new Date(parsed.data.factDate) : null;
  const deviationDays = deviationInDays(existing.planDate, fact);

  const nextStatus = computeStatus(deviationDays);
  const stage = await prisma.ksgStage.update({
    where: { id: req.params.id },
    data: {
      name: parsed.data.name ?? undefined,
      factDate: fact,
      deviationDays,
      status: nextStatus,
    },
    include: { project: { select: { name: true } } },
  });

  if (nextStatus === "критично" && existing.status !== "критично") {
    await notify({
      title: "Критичное отставание по КСГ",
      body: `Этап «${stage.name}» (${stage.project?.name ?? "проект"}) отклонился на ${deviationDays} дн.`,
      type: "ksg",
      link: "ksg.html",
    });
  }

  res.json(stage);
});

// POST /api/ksg/import — загрузка .xlsx с колонками: Проект, Тип этапа, Этап, План, Факт.
// Пока источник — Excel (см. IMPLEMENTATION_PLAN.md), в перспективе — выгрузка из 1С.
ksgRouter.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл file (.xlsx) обязателен" });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ error: "В файле нет листов" });

  const projectCache = new Map<string, string>();
  const created: string[] = [];
  const errors: string[] = [];
  let criticalCount = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const projectName = row.getCell(1).text?.trim();
    const stageType = row.getCell(2).text?.trim();
    const name = row.getCell(3).text?.trim();
    const planRaw = row.getCell(4).value;
    const factRaw = row.getCell(5).value;
    if (!projectName || !name || !planRaw) continue;

    const planDate = planRaw instanceof Date ? planRaw : new Date(String(planRaw));
    if (Number.isNaN(planDate.getTime())) {
      errors.push(`Строка ${rowNumber}: некорректная плановая дата`);
      continue;
    }
    const factDate = factRaw ? (factRaw instanceof Date ? factRaw : new Date(String(factRaw))) : null;

    let projectId = projectCache.get(projectName);
    if (!projectId) {
      const existingProject = await prisma.project.findFirst({ where: { name: projectName } });
      const project = existingProject ?? (await prisma.project.create({ data: { name: projectName, businessLine: "ГК ВМЕСТЕ" } }));
      projectId = project.id;
      projectCache.set(projectName, projectId);
    }

    const deviationDays = deviationInDays(planDate, factDate);
    const status = computeStatus(deviationDays);
    await prisma.ksgStage.create({
      data: { projectId, stageType: stageType || "стройка", name, planDate, factDate, deviationDays, status },
    });
    created.push(name);
    if (status === "критично") criticalCount++;
  }

  if (criticalCount > 0) {
    await notify({
      title: "Импорт КСГ: есть критичные отставания",
      body: `После импорта ${criticalCount} этап(ов) уже критичны на текущую дату — стоит проверить.`,
      type: "ksg",
      link: "ksg.html",
    });
  }

  res.json({ importedRows: created.length, errors });
});
