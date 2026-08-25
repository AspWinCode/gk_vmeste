import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  const { unread } = req.query;
  const notifications = await prisma.notification.findMany({
    where: unread === "true" ? { read: false } : undefined,
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  res.json(notifications);
});

notificationsRouter.get("/unread-count", async (_req, res) => {
  const count = await prisma.notification.count({ where: { read: false } });
  res.json({ count });
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  const notification = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
  res.json(notification);
});

notificationsRouter.post("/read-all", async (_req, res) => {
  await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
  res.json({ ok: true });
});
