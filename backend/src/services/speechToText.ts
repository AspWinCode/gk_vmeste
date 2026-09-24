import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "../lib/env";

const execFileAsync = promisify(execFile);

export interface SpeakerSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  fullText: string;
  segments: SpeakerSegment[];
}

export interface SpeechToTextProvider {
  transcribe(audioFilePath: string, language: string): Promise<TranscriptionResult>;
}

/**
 * Заглушка на время, пока не выбран провайдер STT (см. открытые вопросы в IMPLEMENTATION_PLAN.md:
 * Whisper self-hosted vs облачный, поддержка диаризации по спикерам для русской речи).
 * Возвращает синтетический текст, чтобы конвейер саммари/поручений можно было тестировать end-to-end
 * до подключения реального распознавания.
 */
class StubProvider implements SpeechToTextProvider {
  async transcribe(audioFilePath: string): Promise<TranscriptionResult> {
    const text =
      "[Заглушка STT] Аудиофайл получен и поставлен в очередь, но провайдер распознавания речи ещё не подключён " +
      `(файл: ${audioFilePath}). Настройте STT_PROVIDER в .env и реализуйте провайдер в src/services/speechToText.ts.`;
    return {
      fullText: text,
      segments: [{ speaker: "Система", start: 0, end: 0, text }],
    };
  }
}

interface OpenAiVerboseSegment {
  start: number;
  end: number;
  text: string;
}

interface OpenAiVerboseResponse {
  text: string;
  segments?: OpenAiVerboseSegment[];
}

// Жёсткий лимит самого Whisper API (OpenAI и большинство совместимых прокси, включая AI Tunnel) —
// 25МБ на файл. Это ограничение провайдера, а не MAX_UPLOAD_MB нашего сервера: увеличение
// MAX_UPLOAD_MB решает только приём файла на наш backend, а не то, что примет Whisper дальше.
const WHISPER_SAFE_LIMIT_BYTES = 24 * 1024 * 1024; // чуть меньше 25МБ — запас на неточность сегментации по времени
const COMPRESSED_BITRATE_KBPS = 32; // моно 16кГц/32кбит — с запасом достаточно для распознавания речи, сильно уменьшает размер

// OpenAI Whisper (или совместимый прокси, например "AI Tunnel") — платный по минутам API,
// без диаризации по спикерам (whisper-1 не различает голоса), поэтому все сегменты
// помечены единым безымянным "спикером". Для сравнения текста/тезисов между участниками
// диаризация не нужна — Claude извлекает поручения по содержанию, а не по говорящему.
//
// Длинные записи (совещания на час и больше) почти всегда превышают 25МБ лимит Whisper в
// исходном виде — поэтому перед отправкой файл всегда перекодируется в компактный моно mp3
// через ffmpeg, а если и после сжатия он не укладывается в лимит — режется по времени на
// куски и транскрибируется по частям, с последующей склейкой текста.
class OpenAiWhisperProvider implements SpeechToTextProvider {
  async transcribe(audioFilePath: string, language: string): Promise<TranscriptionResult> {
    if (!env.sttApiKey) {
      throw new Error("STT_API_KEY не задан — распознавание речи недоступно, проверьте .env на сервере");
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-"));
    try {
      const compressedPath = path.join(tmpDir, "compressed.mp3");
      try {
        await execFileAsync("ffmpeg", [
          "-y",
          "-i", audioFilePath,
          "-ac", "1",
          "-ar", "16000",
          "-b:a", `${COMPRESSED_BITRATE_KBPS}k`,
          compressedPath,
        ]);
      } catch (err) {
        throw new Error(
          "Не удалось сжать аудио перед распознаванием (ffmpeg недоступен на сервере worker): " +
            (err instanceof Error ? err.message : String(err))
        );
      }

      const compressedSize = fs.statSync(compressedPath).size;
      const chunkPaths =
        compressedSize <= WHISPER_SAFE_LIMIT_BYTES
          ? [compressedPath]
          : await this.splitByDuration(compressedPath, tmpDir);

      const fullTextParts: string[] = [];
      const allSegments: SpeakerSegment[] = [];
      let offsetSeconds = 0;

      for (const chunkPath of chunkPaths) {
        const chunk = await this.transcribeSingleFile(chunkPath, language);
        if (chunk.text) fullTextParts.push(chunk.text);
        for (const seg of chunk.segments) {
          allSegments.push({ speaker: "Участник", start: seg.start + offsetSeconds, end: seg.end + offsetSeconds, text: seg.text });
        }
        // Смещение для следующего куска — по концу последнего распознанного сегмента этого куска
        // (точная длительность файла нам не нужна больше нигде, поэтому не тянем отдельно через ffprobe).
        if (chunk.segments.length > 0) offsetSeconds += chunk.segments[chunk.segments.length - 1].end;
      }

      const fullText = fullTextParts.join("\n\n").trim();
      return {
        fullText,
        segments: allSegments.length > 0 ? allSegments : [{ speaker: "Участник", start: 0, end: 0, text: fullText }],
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Режет уже сжатый mp3 по времени без повторного перекодирования (-c copy — быстро,
  // без потери качества). Длина куска подобрана так, чтобы при известном битрейте компрессии
  // каждый кусок гарантированно укладывался в лимит Whisper.
  private async splitByDuration(compressedPath: string, tmpDir: string): Promise<string[]> {
    const segmentSeconds = Math.max(60, Math.floor((WHISPER_SAFE_LIMIT_BYTES * 8) / (COMPRESSED_BITRATE_KBPS * 1000)));
    const pattern = path.join(tmpDir, "chunk-%03d.mp3");
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", compressedPath,
      "-f", "segment",
      "-segment_time", String(segmentSeconds),
      "-c", "copy",
      pattern,
    ]);
    return fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("chunk-"))
      .sort()
      .map((f) => path.join(tmpDir, f));
  }

  private async transcribeSingleFile(filePath: string, language: string): Promise<{ text: string; segments: OpenAiVerboseSegment[] }> {
    const fileBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", env.sttModel);
    form.append("language", language);
    form.append("response_format", "verbose_json");

    const res = await fetch(`${env.sttBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.sttApiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Whisper API вернул ошибку ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as OpenAiVerboseResponse;
    return { text: data.text.trim(), segments: data.segments ?? [] };
  }
}

const providers: Record<string, () => SpeechToTextProvider> = {
  stub: () => new StubProvider(),
  openai: () => new OpenAiWhisperProvider(),
};

export function getSpeechToTextProvider(): SpeechToTextProvider {
  const factory = providers[env.sttProvider];
  if (!factory) {
    throw new Error(`Неизвестный STT_PROVIDER: ${env.sttProvider}`);
  }
  return factory();
}
