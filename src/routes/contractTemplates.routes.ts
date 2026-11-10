import { Router } from 'express';
import { prisma, auditedTransaction } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();
router.use(requireAuth);

// GET /api/contract-templates
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const category = ((req.query.category as string) || '').trim();

  const conditions: any[] = [];

  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { description: { contains: search, mode: 'insensitive' as const } },
        { content: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }

  if (category && category !== 'all') {
    conditions.push({ category });
  }

  const where: any = conditions.length > 1
    ? { AND: conditions }
    : (conditions[0] || {});

  const sortBy = ((req.query.sortBy as string) || 'name').trim();
  const sortOrder = ((req.query.sortOrder as string) || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const orderBy: any = { [sortBy]: sortOrder };

  const pagination = parsePagination(req.query, 25);

  if (req.query.fields === 'summary') {
    const summarySelect = {
      id: true,
      name: true,
      category: true,
      description: true,
    };

    if (pagination.isPaginated) {
      const [total, items] = await Promise.all([
        prisma.contractTemplate.count({ where }),
        prisma.contractTemplate.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
          select: summarySelect,
        }),
      ]);
      res.json(buildPaginatedResponse(items, total, pagination.page, pagination.limit));
      return;
    }

    const items = await prisma.contractTemplate.findMany({
      where,
      orderBy,
      select: summarySelect,
    });
    res.json(items);
    return;
  }

  if (pagination.isPaginated) {
    const [total, items] = await Promise.all([
      prisma.contractTemplate.count({ where }),
      prisma.contractTemplate.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);
    res.json(buildPaginatedResponse(items, total, pagination.page, pagination.limit));
    return;
  }

  const items = await prisma.contractTemplate.findMany({
    where,
    orderBy,
  });

  res.json(items);
}));

// GET /api/contract-templates/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const template = await prisma.contractTemplate.findUnique({
    where: { id },
  });

  if (!template) {
    res.status(404).json({ error: 'Šablon ugovora nije pronađen.' });
    return;
  }

  res.json(template);
}));

// POST /api/contract-templates
router.post('/', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'create')) {
    res.status(403).json({ error: 'Nemate dozvolu za kreiranje šablona ugovora.' });
    return;
  }

  const { name, category = 'General', description, content } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Naziv šablona je obavezan.' });
    return;
  }

  if (!content || !content.trim()) {
    res.status(400).json({ error: 'Sadržaj šablona je obavezan.' });
    return;
  }

  const template = await auditedTransaction(async (tx) => {
    return await tx.contractTemplate.create({
      data: {
        name: name.trim(),
        category: category ? category.trim() : 'General',
        description: description ? description.trim() : null,
        content: content.trim(),
      },
    });
  });

  res.status(201).json(template);
}));

// PUT /api/contract-templates/:id
router.put('/:id', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'edit')) {
    res.status(403).json({ error: 'Nemate dozvolu za izmenu šablona ugovora.' });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.contractTemplate.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Šablon ugovora nije pronađen.' });
    return;
  }

  const { name, category, description, content } = req.body;

  const updated = await auditedTransaction(async (tx) => {
    return await tx.contractTemplate.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : existing.name,
        category: category !== undefined ? (category ? category.trim() : 'General') : existing.category,
        description: description !== undefined ? (description ? description.trim() : null) : existing.description,
        content: content !== undefined ? content.trim() : existing.content,
      },
    });
  });

  res.json(updated);
}));

// DELETE /api/contract-templates/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'delete')) {
    res.status(403).json({ error: 'Nemate dozvolu za brisanje šablona ugovora.' });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.contractTemplate.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Šablon ugovora nije pronađen.' });
    return;
  }

  await auditedTransaction(async (tx) => {
    await tx.contractTemplate.delete({
      where: { id },
    });
  });

  res.json({ message: 'Šablon ugovora je uspešno obrisan.' });
}));

export default router;
