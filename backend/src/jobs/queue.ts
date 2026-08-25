import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../lib/env";

export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

export interface TranscriptionJobData {
  jobId: string;
}

export const transcriptionQueue = new Queue<TranscriptionJobData>("transcription", { connection });
