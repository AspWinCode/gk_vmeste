import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfNextWeek() {
  const d = startOfToday();
  d.setDate(d.getDate() + 7);
  return d;
}

// GET /api/tasks — «Поручения дня» на рабочем столе, карточка «Извлечённые поручения»
// в Транскрибаторе и отдельная страница «Задачи» (tasks.html) — все три используют этот
// один эндпоинт с разными комбинациями фильтров.
// ?mine=true — личные напоминания (kind=REMINDER) видны только их создателю, поэтому
// этот фильтр всегда по req.auth.userId, а не по произвольному query-параметру.
tasksRouter.get("/", async (req, res) => {
  const { status, projectId, source, ownerId, kind, priority, period, mine } = req.query;

  const where: any = {
    status: typeof status === "string" ? status : undefined,
    projectId: typeof projectId === "string" ? projectId : undefined,
    source: typeof source === "string" ? source : undefined,
    ownerId: typeof ownerId === "string" ? ownerId : undefined,
    kind: typeof kind === "string" ? kind : undefined,
    priority: typeof priority === "string" ? priority : undefined,
  };

  if (mine === "true") where.createdById = req.auth!.userId;

  if (period === "today") {
    where.dueDate = { gte: startOfToday(), lt: new Date(startOfToday().getTime() + 86400000) };
  } else if (period === "week") {
    where.dueDate = { gte: startOfToday(), lt: startOfNextWeek() };
  } else if (period === "critical") {
    where.priority = "HIGH";
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { name: true } },
      owner: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
  });
  res.json(tasks);
});

tasksRouter.get("/:id", async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      project: { select: { name: true } },
      owner: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
    },
  });
  if (!task) return res.status(404).json({ error: "Задача не найдена" });
  res.json(task);
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  projectId: z.string().optional(),
  ownerId: z.string().optional(),
  source: z.string().optional(),
  kind: z.enum(["TASK", "REMINDER"]).default("TASK"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

// POST /api/tasks — ручное добавление задачи ИЛИ личного напоминания (kind=REMINDER).
// createdById всегда берётся из токена, а не из тела запроса — иначе можно было бы
// создать "чужое" напоминание.
tasksRouter.post("/", async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dueDate, ...rest } = parsed.data;
  const task = await prisma.task.create({
    data: { ...rest, dueDate: dueDate ? new Date(dueDate) : undefined, createdById: req.auth!.userId },
  });
  res.status(201).json(task);
});

const updateTaskSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});

tasksRouter.patch("/:id", async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dueDate, ...rest } = parsed.data;
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: { ...rest, dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null },
  });
  res.json(task);
});

tasksRouter.delete("/:id", async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const addCommentSchema = z.object({ body: z.string().min(1) });

tasksRouter.post("/:id/comments", async (req, res) => {
  const parsed = addCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const comment = await prisma.taskComment.create({
    data: { taskId: req.params.id, body: parsed.data.body, authorId: req.auth!.userId },
    include: { author: { select: { id: true, name: true } } },
  });
  res.status(201).json(comment);
});
