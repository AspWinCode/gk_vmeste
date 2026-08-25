import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const createProjectSchema = z.object({
  name: z.string().min(1),
  businessLine: z.string().min(1),
  region: z.string().optional(),
});

projectsRouter.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { tasks: true, ksgStages: true, transcriptions: true } },
    },
  });
  res.json(projects);
});

projectsRouter.post("/", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await prisma.project.create({ data: parsed.data });
  res.status(201).json(project);
});

projectsRouter.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { tasks: true, ksgStages: true, financeScenarios: true, transcriptions: true, landObjects: true },
  });
  if (!project) return res.status(404).json({ error: "Проект не найден" });
  res.json(project);
});
