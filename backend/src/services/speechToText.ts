import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { env } from "../lib/env";

const execFileAsync = promisify(execFile);

// Глобальный fetch в Node использует СВОЮ встроенную версию undici — Agent из npm-пакета
// undici (другая версия) с ним несовместим ("invalid onRequestStart method"). Поэтому для
// STT-запросов берём fetch из самого пакета undici, а не глобальный — тогда Agent и fetch
// гарантированно одной версии.
//
// Нужен увеличенный таймаут, потому что дефолтные 300с на ожидание заголовков ответа
// не всегда хватает: диаризация на AI Tunnel на практике ощутимо медленнее реального времени
// и с заметным разбросом (замерено: 75с на 3 минуты речи, но видели клиентский обрыв и на
// куске в 2.5 минуты). Отдельный Agent — только для STT-запросов, на остальные (Claude и т.д.,
// которые заметно быстрее) не влияет.
const sttDispatcher = new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 });

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

// diarized_json — отдельный формат ответа у gpt-4o-transcribe-diarize (единственная модель
// в каталоге AI Tunnel с реальной диаризацией, см. комментарий у DIARIZE_MODEL ниже):
// сегменты приходят с буквенной меткой говорящего ("A", "B", ...), остальные модели
// (whisper-1 и т.п.) такого поля не возвращают вообще.
interface OpenAiDiarizedSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

interface OpenAiDiarizedResponse {
  text: string;
  segments?: OpenAiDiarizedSegment[];
}

// Жёсткий лимит самого Whisper API (OpenAI и большинство совместимых прокси, включая AI Tunnel) —
// 25МБ на файл. Это ограничение провайдера, а не MAX_UPLOAD_MB нашего сервера: увеличение
// MAX_UPLOAD_MB решает только приём файла на наш backend, а не то, что примет Whisper дальше.
const WHISPER_SAFE_LIMIT_BYTES = 24 * 1024 * 1024; // чуть меньше 25МБ — запас на неточность сегментации по времени
const COMPRESSED_BITRATE_KBPS = 32; // моно 16кГц/32кбит — с запасом достаточно для распознавания речи, сильно уменьшает размер

// Единственная модель с реальной диаризацией в каталоге AI Tunnel (проверено напрямую через
// их API) — остальные (whisper-1, whisper-large-v3, chirp-3 и т.д.) спикеров не различают
// вообще. Дороже whisper-1 (2.2-3₽/мин против 1.2₽/мин), поэтому включается только если явно
// выбрана через STT_MODEL — дефолт (whisper-1) её не требует и работает как раньше.
const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";

// У diarize-модели ОТДЕЛЬНЫЙ жёсткий лимит — не по размеру файла, а по длительности:
// "audio duration ... longer than 1400 seconds which is the maximum for this model" (реальный
// ответ AI Tunnel). При нашем битрейте сжатия (32кбит моно) запись на ~29 минут укладывается
// в 25МБ размером и ПОКАЗАЛАСЬ бы коду "не требующей нарезки" по старой логике (только по
// размеру) — поэтому для этой модели длительность проверяется отдельно через ffprobe.
const DIARIZE_MAX_DURATION_SECONDS = 1400;

// Диаризация у AI Tunnel обрабатывается МЕДЛЕННЕЕ реального времени — измерено напрямую:
// 3 минуты реальной речи обрабатывались 75 секунд. Кусок на 20 минут (наш прежний запас)
// обрабатывался бы ~10 минут и гарантированно ловит 524 (таймаут на их прокси/Cloudflare,
// не наш собственный). Поэтому для diarize-модели куски режутся гораздо мельче, чем позволяет
// жёсткий лимит в 1400 сек — не из-за лимита длительности, а из-за реального времени обработки.
const DIARIZE_SAFE_DURATION_SECONDS = 150;

// OpenAI Whisper-совместимый провайдер (или прокси типа AI Tunnel) — платный по минутам API.
// Диаризация по спикерам есть только у DIARIZE_MODEL; на остальных моделях все сегменты
// помечаются единым безымянным "Участник" — для извлечения поручений/саммари Claude это не
// мешает (он работает по содержанию, а не по говорящему), но в самой расшифровке реплики не
// подписаны по именам/буквам.
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
      const isDiarizing = env.sttModel === DIARIZE_MODEL;
      let exceedsDuration = false;
      if (isDiarizing) {
        const durationSeconds = await this.getAudioDurationSeconds(compressedPath).catch(() => null);
        exceedsDuration = durationSeconds !== null && durationSeconds > DIARIZE_MAX_DURATION_SECONDS;
      }

      const chunkPaths =
        compressedSize <= WHISPER_SAFE_LIMIT_BYTES && !exceedsDuration
          ? [compressedPath]
          : await this.splitByDuration(compressedPath, tmpDir, isDiarizing);

      const fullTextParts: string[] = [];
      const allSegments: SpeakerSegment[] = [];
      let offsetSeconds = 0;

      for (const chunkPath of chunkPaths) {
        const chunk = await this.transcribeSingleFile(chunkPath, language);
        if (chunk.text) fullTextParts.push(chunk.text);
        for (const seg of chunk.segments) {
          allSegments.push({ speaker: seg.speaker, start: seg.start + offsetSeconds, end: seg.end + offsetSeconds, text: seg.text });
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

  private async getAudioDurationSeconds(filePath: string): Promise<number> {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    if (!Number.isFinite(seconds)) throw new Error("ffprobe не вернул длительность файла");
    return seconds;
  }

  // Режет уже сжатый mp3 по времени без повторного перекодирования (-c copy — быстро,
  // без потери качества). Длина куска — минимум из двух лимитов: по размеру (из битрейта
  // компрессии) и, для diarize-модели, по длительности (DIARIZE_SAFE_DURATION_SECONDS) —
  // смотря какой из них жёстче для конкретной записи.
  private async splitByDuration(compressedPath: string, tmpDir: string, isDiarizing: boolean): Promise<string[]> {
    const sizeBasedSeconds = Math.floor((WHISPER_SAFE_LIMIT_BYTES * 8) / (COMPRESSED_BITRATE_KBPS * 1000));
    const segmentSeconds = Math.max(
      60,
      isDiarizing ? Math.min(sizeBasedSeconds, DIARIZE_SAFE_DURATION_SECONDS) : sizeBasedSeconds
    );
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

  private fetchTranscription(form: UndiciFormData): Promise<Response> {
    return undiciFetch(`${env.sttBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.sttApiKey}` },
      body: form,
      dispatcher: sttDispatcher,
    }) as unknown as Promise<Response>;
  }

  private async transcribeSingleFile(
    filePath: string,
    language: string
  ): Promise<{ text: string; segments: (OpenAiVerboseSegment & { speaker: string })[] }> {
    const isDiarizing = env.sttModel === DIARIZE_MODEL;
    const fileBuffer = fs.readFileSync(filePath);
    // Конкретно FormData/Blob из пакета undici, не глобальные — fetch тоже из undici (см.
    // комментарий у sttDispatcher) и не распознаёт глобальный FormData как "свой", из-за чего
    // тело запроса улетало как голый текст вместо multipart/form-data (AI Tunnel отвечал 400).
    const form = new UndiciFormData();
    form.append("file", new Blob([fileBuffer], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", env.sttModel);
    form.append("language", language);
    form.append("response_format", isDiarizing ? "diarized_json" : "verbose_json");
    // AI Tunnel требует этот параметр для diarize-моделей (хотя в их доке он значится
    // опциональным) — без него /audio/transcriptions отвечает 400 "chunking_strategy is
    // required for diarization models".
    if (isDiarizing) form.append("chunking_strategy", "auto");

    // При мелкой нарезке на один файл выходит много последовательных запросов (например,
    // ~12 для получасовой записи при чанке в 150с) — с ростом их числа растёт и шанс поймать
    // случайный 524/таймаут на стороне AI Tunnel хотя бы один раз (замерено: разброс времени
    // обработки заметный даже на одинаковых по длине кусках). До 2 повторов с паузой дешевле,
    // чем ронять всю задачу и пересчитывать её целиком заново.
    let res: Response | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await this.fetchTranscription(form);
        if (res.ok || res.status < 500) break;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Whisper API вернул ошибку ${res.status}: ${detail.slice(0, 300)}`);
    }

    if (isDiarizing) {
      const data = (await res.json()) as OpenAiDiarizedResponse;
      const segments = data.segments ?? [];
      // Буквенную метку модели ("A", "B", ...) делаем читаемой ("Спикер A") и вшиваем прямо
      // в текст построчно — это единственное место в интерфейсе, где показывается расшифровка
      // (speakerSegments в БД никто отдельно не рендерит), поэтому разметка по говорящим
      // должна быть видна сразу в самом тексте, а не только в сыром JSON.
      const text = segments.map((s) => `Спикер ${s.speaker}: ${s.text.trim()}`).join("\n");
      return { text, segments: segments.map((s) => ({ ...s, speaker: `Спикер ${s.speaker}` })) };
    }

    const data = (await res.json()) as OpenAiVerboseResponse;
    const segments = data.segments ?? [];
    // data.text — один сплошной абзац без разбивки; сегменты Whisper режет по паузам/фразам,
    // так что текст по сегментам читается куда ближе к естественной речи с переносами строк.
    const text = segments.length > 0 ? segments.map((s) => s.text.trim()).join("\n") : data.text.trim();
    return { text, segments: segments.map((s) => ({ ...s, speaker: "Участник" })) };
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
