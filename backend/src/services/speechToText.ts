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

const providers: Record<string, () => SpeechToTextProvider> = {
  stub: () => new StubProvider(),
  // whisper: () => new WhisperProvider(env.sttApiKey),
  // yandex: () => new YandexSpeechKitProvider(env.sttApiKey),
};

export function getSpeechToTextProvider(): SpeechToTextProvider {
  const factory = providers[env.sttProvider];
  if (!factory) {
    throw new Error(`Неизвестный STT_PROVIDER: ${env.sttProvider}`);
  }
  return factory();
}
