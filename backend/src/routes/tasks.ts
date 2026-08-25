import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

// GET /api/tasks — «Поручения дня» на рабочем столе руководителя.
tasksRouter.get("/", async (req, res) => {
  const { status, projectId, source } = req.query;
  const tasks = await prisma.task.findMany({
    where: {
      status: typeof status === "string" ? (status as any) : undefined,
      projectId: typeof projectId === "string" ? projectId : undefined,
      source: typeof source === "string" ? source : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { name: true } }, owner: { select: { name: true } } },
  });
  res.json(tasks);
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  projectId: z.string().optional(),
  ownerId: z.string().optional(),
  source: z.string().optional(),
});

tasksRouter.post("/", async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dueDate, ...rest } = parsed.data;
  const task = await prisma.task.create({
    data: { ...rest, dueDate: dueDate ? new Date(dueDate) : undefined },
  });
  res.status(201).json(task);
});

const updateTaskSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  title: z.string().min(1).optional(),
  ownerId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

tasksRouter.patch("/:id", async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dueDate, ...rest } = parsed.data;
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: { ...rest, dueDate: dueDate ? new Date(dueDate) : undefined },
  });
  res.json(task);
});
