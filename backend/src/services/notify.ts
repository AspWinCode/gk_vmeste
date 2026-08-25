import { prisma } from "../lib/prisma";

export async function notify(input: { title: string; body: string; type: string; link?: string }) {
  return prisma.notification.create({ data: input });
}
