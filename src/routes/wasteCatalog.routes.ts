import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { getReferenceCache, setReferenceCache, invalidateReferenceCachePrefix } from '../helpers/referenceCache';
import { parseSince, fetchDeletedIds, buildDeltaResponse } from '../helpers/deltaSync';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();

router.use(requireAuth);

// GET /api/waste-catalog
router.get('/', asyncHandler(async (req, res) => {

  const sinceDate = parseSince(req.query.since);
  const search = ((req.query.search as string) || '').trim();
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 500 });
  const isPaginated = pagination.isPaginated;
  const page = pagination.page;
  const limit = pagination.take;

  const orderBy = [
    { frequent: { sort: 'asc' as const, nulls: 'last' as const } },
    { code: 'asc' as const },
  ];

  if (sinceDate) {
    const deltaWhere: any = {
      updatedAt: { gt: sinceDate },
      ...(search ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ]
      } : {}),
    };

    const [items, deletedIds, totalCount] = await Promise.all([
      prisma.wasteCatalog.findMany({
        where: deltaWhere,
        orderBy,
      }),
      fetchDeletedIds('WasteCatalog', sinceDate),
      prisma.wasteCatalog.count(),
    ]);

    const deltaResponse = buildDeltaResponse(items, deletedIds, sinceDate);
    if (typeof deltaResponse === 'object' && !Array.isArray(deltaResponse)) {
      (deltaResponse as any).totalCount = totalCount;
    }
    res.json(deltaResponse);
    return;
  }

  const isFresh = req.query.fresh === 'true';
  let cacheKey: string | null = null;
  if (!search) {
    if (!isPaginated) {
      cacheKey = 'reference:wasteCatalog:all';
    } else if (page === 1) {
      cacheKey = `reference:wasteCatalog:p1:${limit || 'all'}`;
    }
  }

  if (cacheKey && !isFresh) {
    const cached = getReferenceCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
  }

  const where = search ? {
    OR: [
      { code: { contains: search, mode: 'insensitive' as const } },
      { description: { contains: search, mode: 'insensitive' as const } },
    ]
  } : {};

  if (isPaginated) {
    const [items, total] = await Promise.all([
      prisma.wasteCatalog.findMany({
        where,
        orderBy,
        take: pagination.take,
        skip: pagination.skip,
      }),
      prisma.wasteCatalog.count({ where }),
    ]);

    const response = buildPaginatedResponse(items, total, pagination);

    if (cacheKey) {
      setReferenceCache(cacheKey, response);
    }

    res.json(response);
    return;
  }

  const items = await prisma.wasteCatalog.findMany({
    where,
    orderBy,
  });

  if (cacheKey) {
    setReferenceCache(cacheKey, items);
  }

  res.json(items);
}));

// GET /api/waste-catalog/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const item = await prisma.wasteCatalog.findUnique({ where: { id } });
  if (!item) {
    res.status(404).json({ error: 'Waste catalog item not found.' });
    return;
  }
  res.json(item);
}));

// PATCH /api/waste-catalog/:id/frequent - Toggle or set frequent rank
router.patch('/:id/frequent', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'permits', 'edit') && !hasPermission(req.authUser, 'permits', 'create')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to modify waste catalog items.' });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { frequent } = req.body || {};

  const existing = await prisma.wasteCatalog.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Waste catalog item not found.' });
    return;
  }

  let newFrequentValue: number | null;
  if (frequent === undefined) {
    // Toggle: if currently frequent, clear to null; otherwise set to 1
    newFrequentValue = existing.frequent !== null ? null : 1;
  } else if (typeof frequent === 'boolean') {
    newFrequentValue = frequent ? 1 : null;
  } else if (frequent === null || frequent === '') {
    newFrequentValue = null;
  } else {
    const parsed = parseInt(String(frequent), 10);
    newFrequentValue = isNaN(parsed) ? null : parsed;
  }

  const updated = await prisma.wasteCatalog.update({
    where: { id },
    data: { frequent: newFrequentValue },
  });

  invalidateReferenceCachePrefix('reference:wasteCatalog');
  res.json(updated);
}));

// POST /api/waste-catalog
router.post('/', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'permits', 'create')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to add waste catalog items.' });
    return;
  }

  const { code, description, hazardListMark, isHazardous, frequent } = req.body || {};

  if (!code || !description) {
    res.status(400).json({ error: 'Code and description are required.' });
    return;
  }

  const frequentVal = frequent !== undefined ? (frequent === null ? null : parseInt(String(frequent), 10) || null) : undefined;

  const item = await prisma.wasteCatalog.upsert({
    where: { code: code.trim() },
    update: {
      description: description.trim(),
      hazardListMark: hazardListMark ? hazardListMark.trim() : null,
      isHazardous: Boolean(isHazardous),
      ...(frequentVal !== undefined ? { frequent: frequentVal } : {}),
    },
    create: {
      code: code.trim(),
      description: description.trim(),
      hazardListMark: hazardListMark ? hazardListMark.trim() : null,
      isHazardous: Boolean(isHazardous),
      frequent: frequentVal !== undefined ? frequentVal : null,
    },
  });

  invalidateReferenceCachePrefix('reference:wasteCatalog');
  res.status(201).json(item);
}));

// DELETE /api/waste-catalog/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'permits', 'delete')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to delete waste catalog items.' });
    return;
  }

  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const existing = await prisma.wasteCatalog.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Waste catalog item not found.' });
    return;
  }

  await prisma.wasteCatalog.delete({ where: { id } });
  invalidateReferenceCachePrefix('reference:wasteCatalog');
  res.status(204).send();
}));

export default router;
