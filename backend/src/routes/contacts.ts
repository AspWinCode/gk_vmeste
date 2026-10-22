import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

// Справочник получателей отчётов (Настройки → "Справочник получателей"), используется
// в Транскрибаторе для быстрого выбора, кому отправить протокол встречи. Не связан
// с учётными записями пользователей — см. комментарий у model Contact в schema.prisma.
export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get("/", async (_req, res) => {
  const contacts = await prisma.contact.findMany({ orderBy: { fullName: "asc" } });
  res.json(contacts);
});

const contactSchema = z.object({
  fullName: z.string().min(1),
  position: z.string().optional(),
  email: z.string().email(),
});

contactsRouter.post("/", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.contact.findUnique({ where: { email: parsed.data.email } });
  if (existing) return res.status(409).json({ error: "Контакт с такой почтой уже есть в справочнике" });

  const contact = await prisma.contact.create({ data: parsed.data });
  res.status(201).json(contact);
});

const updateContactSchema = contactSchema.partial();

contactsRouter.patch("/:id", async (req, res) => {
  const parsed = updateContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const contact = await prisma.contact.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(contact);
});

contactsRouter.delete("/:id", async (req, res) => {
  await prisma.contact.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
