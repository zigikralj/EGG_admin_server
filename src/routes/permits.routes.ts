import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { isAdminOrManager } from '../types';

const router = Router();

router.use(requireAuth);

function formatPermit(p: any) {
  const clientsList = (p.clientExtraData || []).map((ed: any) => ed.client).filter(Boolean);
  const wasteCatalogs = (p.permitWastes || []).map((pw: any) => pw.wasteCatalog).filter(Boolean);
  const wasteCatalogIds = (p.permitWastes || []).map((pw: any) => pw.wasteCatalogId);
  const wasteCatalog = wasteCatalogs[0] || null;
  const wasteCatalogId = wasteCatalogIds[0] || null;
  const indexNumber = wasteCatalog?.code || '';

  return {
    ...p,
    clients: clientsList,
    clientName: clientsList[0]?.name || null,
    clientId: clientsList[0]?.id || null,
    wasteCatalog,
    wasteCatalogId,
    wasteCatalogs,
    wasteCatalogIds,
    indexNumber,
  };
}

// GET /api/permits
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const where = search ? {
    OR: [
      { permitNumber: { contains: search, mode: 'insensitive' as const } },
      { notes: { contains: search, mode: 'insensitive' as const } },
      { clientExtraData: { some: { client: { name: { contains: search, mode: 'insensitive' as const } } } } },
      {
        permitWastes: {
          some: {
            wasteCatalog: {
              OR: [
                { code: { contains: search, mode: 'insensitive' as const } },
                { description: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          },
        },
      },
    ],
  } : {};

  const permits = await prisma.permit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  res.json(permits.map(formatPermit));
}));

// GET /api/permits/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const permit = await prisma.permit.findUnique({
    where: { id },
    include: {
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  if (!permit) {
    res.status(404).json({ error: 'Permit not found' });
    return;
  }

  res.json(formatPermit(permit));
}));

// POST /api/permits
router.post('/', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can create permits.' });
    return;
  }

  const { permitNumber, startDate, endDate, notes, wasteCatalogId, wasteCatalogIds } = req.body;
  const targetWcId = wasteCatalogId || (Array.isArray(wasteCatalogIds) ? wasteCatalogIds[0] : null);

  if (!permitNumber || !permitNumber.trim()) {
    res.status(400).json({ error: 'Permit number is required.' });
    return;
  }

  if (!targetWcId) {
    res.status(400).json({ error: 'Waste catalog index number is required.' });
    return;
  }

  const permit = await prisma.permit.create({
    data: {
      permitNumber: permitNumber.trim(),
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes ? notes.trim() : null,
      permitWastes: {
        create: [
          { wasteCatalogId: targetWcId },
        ],
      },
    },
    include: {
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  res.status(201).json(formatPermit(permit));
}));

// PUT /api/permits/:id
router.put('/:id', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can edit permits.' });
    return;
  }

  const id = req.params.id as string;
  const { permitNumber, startDate, endDate, notes, wasteCatalogId, wasteCatalogIds } = req.body;

  const existing = await prisma.permit.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Permit not found' });
    return;
  }

  const targetWcId = wasteCatalogId !== undefined ? wasteCatalogId : (Array.isArray(wasteCatalogIds) ? wasteCatalogIds[0] : undefined);

  if (targetWcId !== undefined) {
    await prisma.permitWaste.deleteMany({
      where: { permitId: id },
    });

    if (targetWcId) {
      await prisma.permitWaste.create({
        data: {
          permitId: id,
          wasteCatalogId: targetWcId,
        },
      });
    }
  }

  const updated = await prisma.permit.update({
    where: { id },
    data: {
      permitNumber: permitNumber !== undefined ? permitNumber.trim() : existing.permitNumber,
      startDate: startDate !== undefined ? startDate : existing.startDate,
      endDate: endDate !== undefined ? endDate : existing.endDate,
      notes: notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
    },
    include: {
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  res.json(formatPermit(updated));
}));

// DELETE /api/permits/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can delete permits.' });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.permit.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Permit not found' });
    return;
  }

  await prisma.permit.delete({ where: { id } });
  res.json({ message: 'Permit deleted successfully' });
}));

export default router;
