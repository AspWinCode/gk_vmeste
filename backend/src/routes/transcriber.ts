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

// Busboy (используется multer) декодирует поле filename как latin1, даже когда браузер
// реально прислал его в UTF-8 (кириллица в имени файла) — без этого получаем "Ð¦Ð½..."
// вместо читаемого имени. Перекодируем обратно в UTF-8 сразу при получении файла.
function fixFilenameEncoding(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${fixFilenameEncoding(file.originalname)}`),
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
      audioFileName: fixFilenameEncoding(req.file.originalname),
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

const addParticipantsSchema = z.object({
  emails: z.array(z.string().email()).min(1),
});

// PATCH /api/transcriber/jobs/:id/participants — «Добавить email» уже после загрузки/обработки,
// не только при первичной форме. Дополняет список, не затирает — дубликаты убираются.
transcriberRouter.patch("/jobs/:id/participants", async (req, res) => {
  const parsed = addParticipantsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const job = await prisma.transcriptionJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Задача не найдена" });

  const merged = Array.from(new Set([...job.participantEmails, ...parsed.data.emails]));
  const updated = await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { participantEmails: merged },
  });
  res.json(updated);
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
    participants: job.participants,
    subject: job.subject,
    discussionPoints: job.discussionPoints,
    decisions: job.decisions,
    plans: job.plans,
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

// POST /api/transcriber/jobs/:id/send — рассылка протокола участникам встречи. Каждому —
// отдельное письмо (не один "to" через запятую), чтобы участники не видели чужие адреса
// и чтобы сбой у одного адресата не блокировал остальных.
transcriberRouter.post("/jobs/:id/send", async (req, res) => {
  const job = await prisma.transcriptionJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Задача не найдена" });
  if (!job.protocolDocPath) {
    return res.status(409).json({ error: "Сначала сформируйте протокол через /export" });
  }
  if (job.participantEmails.length === 0) {
    return res.status(400).json({ error: "У задачи не указаны email-адреса участников" });
  }

  const subject = `${job.subject || job.meetingType || "Итоги записи"} — саммари от ВМЕСТЕ AI`;
  const html = `<p>${(job.summary ?? "").replace(/\n/g, "<br/>")}</p><p>Полный протокол — во вложении.</p>`;

  const results = await Promise.all(
    job.participantEmails.map(async (email) => {
      try {
        const result = await sendProtocolEmail({
          to: [email],
          subject,
          html,
          attachmentPath: job.protocolDocPath!,
          attachmentName: `protocol-${job.id}.docx`,
        });
        return { email, sent: result.sent };
      } catch (err) {
        return { email, sent: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  res.json({ results, sent: results.some((r) => r.sent) });
});
