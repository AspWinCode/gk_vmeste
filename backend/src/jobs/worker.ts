import "dotenv/config";
import { Worker } from "bullmq";
import { connection, TranscriptionJobData } from "./queue";
import { prisma } from "../lib/prisma";
import { getSpeechToTextProvider } from "../services/speechToText";
import { analyzeMeetingTranscript } from "../services/claude";
import { notify } from "../services/notify";

// Отдельный процесс: `npm run worker`. Разнесён от HTTP-сервера, чтобы долгая
// транскрибация/вызовы Claude не блокировали API и масштабировались независимо.
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

      const analysis = await analyzeMeetingTranscript(transcription.fullText);

      const updated = await prisma.transcriptionJob.update({
        where: { id: jobId },
        data: {
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          status: "DONE",
          progressPercent: 100,
        },
      });

      if (analysis.tasks.length > 0) {
        await prisma.task.createMany({
          data: analysis.tasks.map((t) => ({
            title: t.title,
            description: t.owner ? `Ответственный: ${t.owner}` : undefined,
            dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
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
