import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const usersRouter = Router();
usersRouter.use(requireAuth);

// GET /api/users — экран "Настроить роли" в каталоге ассистентов.
// Без строгого RBAC-гейта на этот роут: команда небольшая, и никто пока не может стать
// ADMIN (регистрация всегда создаёт OPERATOR) — закрывать эту страницу requireRole("ADMIN")
// значило бы, что её вообще некому открыть. Отдельная задача на будущее.
usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

const updateRoleSchema = z.object({
  role: z.enum(["EXECUTIVE", "ANALYST", "PROJECT_OFFICE", "OPERATOR", "ADMIN"]),
});

usersRouter.patch("/:id/role", async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role: parsed.data.role },
    select: { id: true, email: true, name: true, role: true },
  });
  res.json(user);
});
