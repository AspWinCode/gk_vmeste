import "dotenv/config";
import { Worker } from "bullmq";
import { connection, TranscriptionJobData } from "./queue";
import { prisma } from "../lib/prisma";
import { getSpeechToTextProvider } from "../services/speechToText";
import { analyzeMeetingTranscript } from "../services/claude";
import { notify } from "../services/notify";

// Отдельный процесс: `npm run worker`. Разнесён от HTTP-сервера, чтобы долгая
// транскрибация/вызовы Claude не блокировали API и масштабировались независимо.

// Claude иногда возвращает dueDate не в ISO 8601, несмотря на инструкцию в промпте
// (например, "через 6 дней" вместо даты) — `new Date(...)` от такой строки даёт
// Invalid Date, а prisma.task.createMany() с Invalid Date не пишет в БД ошибку поля,
// а бросает исключение на весь батч целиком. Без этой проверки одна кривая дата в
// одном из нескольких поручений обрушивала job, который до этого момента уже успешно
// дошёл до статуса DONE (расшифровка и саммари уже сохранены) — статус задачи
// откатывался на FAILED по вине несвязанной мелочи.
function parseDueDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const worker = new Worker<TranscriptionJobData>(
  "transcription",
  async (job) => {
    const { jobId } = job.data;

    const record = await prisma.transcriptionJob.update({
      where: { id: jobId },
      data: { status: "TRANSCRIBING", progressPercent: 10 },
    });

    try {
      const stt = getSpeechToTextProvider();
      const transcription = await stt.transcribe(record.audioFilePath, record.language);

      await prisma.transcriptionJob.update({
        where: { id: jobId },
        data: {
          transcriptText: transcription.fullText,
          speakerSegments: transcription.segments as any,
          status: "SUMMARIZING",
          progressPercent: 60,
        },
      });

      const analysis = await analyzeMeetingTranscript(transcription.fullText, record.meetingType);

      const updated = await prisma.transcriptionJob.update({
        where: { id: jobId },
        data: {
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          participants: analysis.participants,
          subject: analysis.subject,
          discussionPoints: analysis.discussionPoints,
          decisions: analysis.decisions,
          plans: analysis.plans,
          status: "DONE",
          progressPercent: 100,
        },
      });

      if (analysis.tasks.length > 0) {
        await prisma.task.createMany({
          data: analysis.tasks.map((t) => ({
            title: t.title,
            description: t.owner ? `Ответственный: ${t.owner}` : undefined,
            dueDate: parseDueDate(t.dueDate),
            projectId: updated.projectId ?? undefined,
            source: `transcriber:${jobId}`,
          })),
        });
      }

      await notify({
        title: "Транскрибация завершена",
        body: `«${record.audioFileName}» обработан, извлечено поручений: ${analysis.tasks.length}.`,
        type: "transcriber",
        link: "transcriber.html",
      });

      return { status: "done" };
    } catch (err) {
      await prisma.transcriptionJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log("[worker] transcription worker started");
