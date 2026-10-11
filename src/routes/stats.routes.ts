import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { getAuthUser } from '../middleware/auth';
import { isRestrictedToOwn } from '../types';

const router = Router();

// GET /api/projects/stats
router.get('/', asyncHandler(async (req, res) => {
  const authUser = await getAuthUser(req);
  const isOnlyOwn = isRestrictedToOwn(authUser, "projects");

  const cutoffStale = new Date();
  cutoffStale.setMonth(cutoffStale.getMonth() - 2);
  const cutoffStaleStr = cutoffStale.toISOString().slice(0, 10);

  const cutoffMonitor = new Date();
  cutoffMonitor.setDate(cutoffMonitor.getDate() + 14);
  const cutoffMonitorStr = cutoffMonitor.toISOString().slice(0, 10);

  let projectWhere: any = {};
  if (isOnlyOwn && authUser) {
    projectWhere = {
      OR: [
        { responsibleId: authUser.id },
        ...(authUser.name ? [{ responsible: { equals: authUser.name, mode: 'insensitive' as const } }] : []),
      ],
    };
  }

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
    prisma.project.count({ where: { ...projectWhere, done: false } }),
    prisma.project.count({ where: { ...projectWhere, done: true } }),
    prisma.project.count({ where: { ...projectWhere, done: false, start: { lt: cutoffStaleStr } } }),
    prisma.project.count({ where: { ...projectWhere, nextSample: { not: null, lte: cutoffMonitorStr } } }),
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
