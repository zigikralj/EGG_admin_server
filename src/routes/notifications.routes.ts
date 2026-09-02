import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Require authentication for all notification routes
router.use(requireAuth);

// GET /api/notifications
router.get("/", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            clientName: true,
          },
        },
      },
    }),
    prisma.notification.count({
      where: { userId: authUser.id, read: false },
    }),
  ]);

  res.json({ notifications, unreadCount });
}));

// PATCH /api/notifications/mark-all-read
router.patch("/mark-all-read", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;

  const result = await prisma.notification.updateMany({
    where: { userId: authUser.id, read: false },
    data: { read: true },
  });

  res.json({ success: true, count: result.count });
}));

// PATCH /api/notifications/:id/read
router.patch("/:id/read", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const existing = await prisma.notification.findUnique({
    where: { id },
  });

  if (!existing || existing.userId !== authUser.id) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          clientName: true,
        },
      },
    },
  });

  res.json(updated);
}));

// DELETE /api/notifications/clear-all
router.delete("/clear-all", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;

  await prisma.notification.deleteMany({
    where: { userId: authUser.id },
  });

  res.json({ message: "All notifications cleared" });
}));

// DELETE /api/notifications/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const existing = await prisma.notification.findUnique({
    where: { id },
  });

  if (!existing || existing.userId !== authUser.id) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  await prisma.notification.delete({
    where: { id },
  });

  res.json({ message: "Notification deleted successfully" });
}));

export default router;
