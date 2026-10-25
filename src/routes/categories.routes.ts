import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { getReferenceCache, setReferenceCache, invalidateReferenceCache } from '../helpers/referenceCache';

import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();
const CATEGORIES_CACHE_KEY = 'reference:categories';

// Require authentication for all categories routes
router.use(requireAuth);

const requireCategoryPermission = (action: string) => (req: any, res: any, next: any) => {
  if (!hasPermission(req.authUser, "categories", action)) {
    res.status(403).json({ error: "FORBIDDEN", message: `You do not have permission to ${action} categories.` });
    return;
  }
  next();
};

// GET /api/categories
router.get('/', asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const search = ((req.query.search as string) || '').trim().toLowerCase();

  let categories: any[] | null = getReferenceCache(CATEGORIES_CACHE_KEY);
  if (!categories) {
    categories = await prisma.category.findMany({
      orderBy: { createdAt: 'desc' },
    });
    setReferenceCache(CATEGORIES_CACHE_KEY, categories);
  }

  let filtered = categories!;
  if (search) {
    filtered = categories.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(search)) ||
        (c.code && c.code.toLowerCase().includes(search)) ||
        (c.description && c.description.toLowerCase().includes(search))
    );
  }

  const isSummary = req.query.fields === 'summary';
  const formatCategory = (c: any) =>
    isSummary
      ? { id: c.id, code: c.code, name: c.name }
      : c;

  if (isPaginated) {
    const pagination = parsePagination(req.query, {
      defaultSortBy: 'name',
      defaultSortOrder: 'asc',
      maxLimit: 100,
    });
    const total = filtered.length;
    const items = filtered
      .slice(pagination.skip, (pagination.skip || 0) + (pagination.take || 10))
      .map(formatCategory);
    res.json(buildPaginatedResponse(items, total, pagination));
    return;
  }

  res.json(filtered.map(formatCategory));
}));

// POST /api/categories
router.post('/', requireCategoryPermission('create'), asyncHandler(async (req, res) => {
  const { code, name, description } = req.body;
  if (!code || !code.trim() || !name || !name.trim()) {
    res.status(400).json({ error: 'Category code and name are required.' });
    return;
  }

  const formattedCode = code.trim().toLowerCase().replace(/\s+/g, '-');
  const existing = await prisma.category.findUnique({ where: { code: formattedCode } });
  if (existing) {
    res.status(400).json({ error: 'A category with this code already exists.' });
    return;
  }

  const category = await prisma.category.create({
    data: {
      code: formattedCode,
      name: name.trim(),
      description: description ? description.trim() : null,
    },
  });
  invalidateReferenceCache(CATEGORIES_CACHE_KEY);
  res.status(201).json(category);
}));

// PUT /api/categories/:id
router.put('/:id', requireCategoryPermission('edit'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const rawCode = req.body.code;
  const rawName = req.body.name;
  const rawDesc = req.body.description;

  if (rawCode !== undefined && (!rawCode || !String(rawCode).trim())) {
    res.status(400).json({ error: 'Category code cannot be empty.' });
    return;
  }
  if (rawName !== undefined && (!rawName || !String(rawName).trim())) {
    res.status(400).json({ error: 'Category name cannot be empty.' });
    return;
  }

  const formattedCode = rawCode ? String(rawCode).trim().toLowerCase().replace(/\s+/g, '-') : undefined;
  const finalName = rawName ? String(rawName).trim() : undefined;
  const finalDesc = rawDesc !== undefined ? (rawDesc ? String(rawDesc).trim() : null) : undefined;
  
  if (formattedCode) {
    const existing = await prisma.category.findFirst({
      where: {
        id: { not: id },
        code: formattedCode,
      },
    });
    if (existing) {
      res.status(400).json({ error: 'A category with this code already exists.' });
      return;
    }
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      code: formattedCode,
      name: finalName,
      description: finalDesc,
    },
  });
  invalidateReferenceCache(CATEGORIES_CACHE_KEY);
  res.json(category);
}));

// DELETE /api/categories/:id
router.delete('/:id', requireCategoryPermission('delete'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  
  // Need to ensure this doesn't violate foreign key constraints (e.g., invoices using this category)
  // Usually prisma handles this by throwing P2003, which errorHandler will catch and return 500.
  // A better check would be explicitly seeing if it's used, but let's stick to existing behavior
  // handled by errorHandler for now.
  
  await prisma.category.delete({
    where: { id },
  });
  invalidateReferenceCache(CATEGORIES_CACHE_KEY);
  res.status(204).send();
}));

export default router;
