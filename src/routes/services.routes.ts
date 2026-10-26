import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { getReferenceCache, setReferenceCache, invalidateReferenceCache } from '../helpers/referenceCache';

import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();
const SERVICES_CACHE_KEY = 'reference:services';

// Require authentication for all services routes
router.use(requireAuth);

// GET /api/services
router.get('/', asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const search = ((req.query.search as string) || '').trim().toLowerCase();

  let services: any[] | null = getReferenceCache(SERVICES_CACHE_KEY);
  if (!services) {
    services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
    });
    setReferenceCache(SERVICES_CACHE_KEY, services);
  }

  let filtered = services!;
  if (search) {
    filtered = services.filter(
      (s) =>
        (s.name && s.name.toLowerCase().includes(search)) ||
        (s.code && s.code.toLowerCase().includes(search)) ||
        (s.description && s.description.toLowerCase().includes(search))
    );
  }

  const isSummary = req.query.fields === 'summary';
  const formatService = (s: any) =>
    isSummary
      ? { id: s.id, code: s.code, name: s.name }
      : s;

  if (isPaginated) {
    const pagination = parsePagination(req.query, {
      defaultSortBy: 'name',
      defaultSortOrder: 'asc',
      maxLimit: 100,
    });
    const total = filtered.length;
    const items = filtered
      .slice(pagination.skip, (pagination.skip || 0) + (pagination.take || 10))
      .map(formatService);
    res.json(buildPaginatedResponse(items, total, pagination));
    return;
  }

  res.json(filtered.map(formatService));
}));

// POST /api/services
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'services', 'create')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to create services.' });
    return;
  }

  const { code, name, group, frequency, description, customDataModel } = req.body;
  if (!code || !name) {
    res.status(400).json({ error: 'Code and Name are required' });
    return;
  }

  const formattedCode = code.trim().toLowerCase().replace(/\s+/g, '-');
  const trimmedName = name.trim();

  const existing = await prisma.service.findFirst({
    where: {
      OR: [
        { code: formattedCode },
        { name: { equals: trimmedName, mode: 'insensitive' } },
      ],
    },
  });
  
  if (existing) {
    if (existing.code === formattedCode) {
      res.status(400).json({ error: 'A service with this code already exists' });
      return;
    }
    res.status(400).json({ error: 'A service with this name already exists' });
    return;
  }

  const service = await prisma.service.create({
    data: {
      code: formattedCode,
      name: trimmedName,
      group: group || 'grp-legal',
      frequency: Number(frequency) || 0,
      description: description ? description.trim() : null,
      customDataModel: customDataModel !== undefined ? customDataModel : null,
    },
  });
  invalidateReferenceCache(SERVICES_CACHE_KEY);
  res.status(201).json(service);
}));

// PUT /api/services/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'services', 'edit')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to edit services.' });
    return;
  }

  const id = req.params.id as string;
  const { name, group, frequency, description, customDataModel } = req.body;

  if (name && name.trim()) {
    const trimmedName = name.trim();
    const existing = await prisma.service.findFirst({
      where: {
        id: { not: id },
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      res.status(400).json({ error: 'A service with this name already exists' });
      return;
    }
  }

  const updated = await prisma.service.update({
    where: { id },
    data: {
      name: name ? name.trim() : undefined,
      group,
      frequency: Number(frequency) || 0,
      description: description ? description.trim() : null,
      customDataModel: customDataModel !== undefined ? customDataModel : undefined,
    },
  });
  invalidateReferenceCache(SERVICES_CACHE_KEY);
  res.json(updated);
}));

// DELETE /api/services/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'services', 'delete')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to delete services.' });
    return;
  }

  const id = req.params.id as string;
  await prisma.service.delete({ where: { id } });
  invalidateReferenceCache(SERVICES_CACHE_KEY);
  res.json({ message: 'Service deleted successfully' });
}));

export default router;
