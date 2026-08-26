import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Без fallback намеренно: если переменная потеряется, сервер должен явно упасть при
  // старте, а не молча подписывать токены известным из исходников секретом.
  jwtSecret: required("JWT_SECRET"),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  // Кастомный эндпоинт для Anthropic-совместимого прокси (например, "AI Tunnel"),
  // если официальный api.anthropic.com недоступен напрямую. Пусто = дефолт SDK.
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 200),
  sttProvider: process.env.STT_PROVIDER ?? "stub",
  sttApiKey: process.env.STT_API_KEY ?? "",
  // Кастомный эндпоинт для OpenAI-совместимого прокси (например, "AI Tunnel"),
  // если официальный api.openai.com недоступен напрямую. Пусто = api.openai.com.
  sttBaseUrl: process.env.STT_BASE_URL || "https://api.openai.com/v1",
  sttModel: process.env.STT_MODEL ?? "whisper-1",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? "ВМЕСТЕ AI <noreply@vmeste.local>",
  },
};
