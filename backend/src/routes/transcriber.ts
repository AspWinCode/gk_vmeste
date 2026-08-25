import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { requireAuth } from "../middleware/auth";
import { transcriptionQueue } from "../jobs/queue";
import { buildProtocolDocx } from "../services/protocolExport";
import { sendProtocolEmail } from "../services/mailer";

export const transcriberRouter = Router();
transcriberRouter.use(requireAuth);

const uploadDir = path.resolve(env.uploadDir, "audio");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

const createJobSchema = z.object({
  projectId: z.string().optional(),
  meetingType: z.string().optional(),
  language: z.string().default("ru"),
  participantEmails: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((e) => e.trim()).filter(Boolean) : [])),
});

// POST /api/transcriber/jobs — экран «Транскрибатор-референт»: загрузка аудио и постановка в очередь.
transcriberRouter.post("/jobs", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл audio обязателен" });

  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const job = await prisma.transcriptionJob.create({
    data: {
      audioFilePath: req.file.path,
      audioFileName: req.file.originalname,
      language: parsed.data.language,
      meetingType: parsed.data.meetingType,
      participantEmails: parsed.data.participantEmails,
      projectId: parsed.data.projectId,
      createdById: req.auth!.userId,
      status: "QUEUED",
    },
  });

  await transcriptionQueue.add("transcribe", { jobId: job.id });

  res.status(201).json(job);
});

// GET /api/transcriber/jobs — «Очередь обработки» на экране.
transcriberRouter.get("/jobs", async (_req, res) => {
  const jobs = await prisma.transcriptionJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(jobs);
});

transcriberRouter.get("/jobs/:id", async (req, res) => {
  const job = await prisma.transcriptionJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Задача не найдена" });
  res.json(job);
});

// POST /api/transcriber/jobs/:id/export — «Скачать .docx» из результата обработки.
transcriberRouter.post("/jobs/:id/export", async (req, res) => {
  const job = await prisma.transcriptionJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Задача не найдена" });
  if (job.status !== "DONE") return res.status(409).json({ error: "Обработка ещё не завершена" });

  const tasks = await prisma.task.findMany({ where: { source: `transcriber:${job.id}` } });

  const filePath = await buildProtocolDocx({
    jobId: job.id,
    meetingType: job.meetingType,
    summary: job.summary ?? "",
    keyPoints: job.keyPoints,
    tasks: tasks.map((t) => ({
      title: t.title,
      owner: t.description?.replace("Ответственный: ", "") ?? null,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    })),
    transcriptExcerpt: (job.transcriptText ?? "").slice(0, 2000),
  });

  await prisma.transcriptionJob.update({ where: { id: job.id }, data: { protocolDocPath: filePath } });

  res.download(filePath, `protocol-${job.id}.docx`);
});

// POST /api/transcriber/jobs/:id/send — email-рассылка протокола участникам встречи.
transcriberRouter.post("/jobs/:id/send", async (req, res) => {
  const job = await prisma.transcriptionJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Задача не найдена" });
  if (!job.protocolDocPath) {
    return res.status(409).json({ error: "Сначала сформируйте протокол через /export" });
  }
  if (job.participantEmails.length === 0) {
    return res.status(400).json({ error: "У задачи не указаны email-адреса участников" });
  }

  const result = await sendProtocolEmail({
    to: job.participantEmails,
    subject: `Протокол встречи — ${job.meetingType ?? "без темы"}`,
    html: `<p>${(job.summary ?? "").replace(/\n/g, "<br/>")}</p>`,
    attachmentPath: job.protocolDocPath,
    attachmentName: `protocol-${job.id}.docx`,
  });

  res.json(result);
});
