import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/projects/stats
router.get('/', asyncHandler(async (_req, res) => {
  const cutoffStale = new Date();
  cutoffStale.setMonth(cutoffStale.getMonth() - 2);
  const cutoffStaleStr = cutoffStale.toISOString().slice(0, 10);

  const cutoffMonitor = new Date();
  cutoffMonitor.setDate(cutoffMonitor.getDate() + 14);
  const cutoffMonitorStr = cutoffMonitor.toISOString().slice(0, 10);

  const [
    active,
    done,
    stale,
    monitor,
    clientsCount,
    usersCount,
    servicesCount,
    categoriesCount,
    invoicesCount,
    providedServicesCount
  ] = await Promise.all([
    prisma.project.count({ where: { done: false } }),
    prisma.project.count({ where: { done: true } }),
    prisma.project.count({ where: { done: false, start: { lt: cutoffStaleStr } } }),
    prisma.project.count({ where: { nextSample: { not: null, lte: cutoffMonitorStr } } }),
    prisma.client.count(),
    prisma.user.count(),
    prisma.service.count(),
    prisma.category.count(),
    prisma.invoice.count(),
    prisma.providedService.count(),
  ]);

  res.json({
    active,
    done,
    stale,
    monitor,
    clientsCount,
    usersCount,
    servicesCount,
    categoriesCount,
    invoicesCount,
    providedServicesCount,
  });
}));

export default router;
