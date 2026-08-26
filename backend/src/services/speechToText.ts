import fs from "fs";
import { env } from "../lib/env";

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

const EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
  mp4: "audio/mp4",
};

interface OpenAiVerboseSegment {
  start: number;
  end: number;
  text: string;
}

interface OpenAiVerboseResponse {
  text: string;
  segments?: OpenAiVerboseSegment[];
}

// OpenAI Whisper (или совместимый прокси, например "AI Tunnel") — платный по минутам API,
// без диаризации по спикерам (whisper-1 не различает голоса), поэтому все сегменты
// помечены единым безымянным "спикером". Для сравнения текста/тезисов между участниками
// диаризация не нужна — Claude извлекает поручения по содержанию, а не по говорящему.
class OpenAiWhisperProvider implements SpeechToTextProvider {
  async transcribe(audioFilePath: string, language: string): Promise<TranscriptionResult> {
    if (!env.sttApiKey) {
      throw new Error("STT_API_KEY не задан — распознавание речи недоступно, проверьте .env на сервере");
    }

    const ext = audioFilePath.split(".").pop()?.toLowerCase() ?? "mp3";
    const fileBuffer = fs.readFileSync(audioFilePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileBuffer], { type: EXT_TO_MIME[ext] ?? "application/octet-stream" }),
      `audio.${ext}`
    );
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
    const segments: SpeakerSegment[] = (data.segments ?? []).map((s) => ({
      speaker: "Участник",
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    return {
      fullText: data.text.trim(),
      segments: segments.length > 0 ? segments : [{ speaker: "Участник", start: 0, end: 0, text: data.text.trim() }],
    };
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
