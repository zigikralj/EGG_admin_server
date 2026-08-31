import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { UserRole } from '../types';

const router = Router();

// Require authentication for all categories routes
router.use(requireAuth);

// Helper to check for admin/manager rights
const requireAdminOrManager = (req: any, res: any, next: any) => {
  const role = req.authUser!.role;
  if (role !== UserRole.ADMINISTRATOR && role !== UserRole.MANAGER) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Only administrators and managers can perform this action.' });
    return;
  }
  next();
};

// GET /api/categories
router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(categories);
}));

// POST /api/categories
router.post('/', requireAdminOrManager, asyncHandler(async (req, res) => {
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
  res.status(201).json(category);
}));

// PUT /api/categories/:id
router.put('/:id', requireAdminOrManager, asyncHandler(async (req, res) => {
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
  res.json(category);
}));

// DELETE /api/categories/:id
router.delete('/:id', requireAdminOrManager, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  
  // Need to ensure this doesn't violate foreign key constraints (e.g., invoices using this category)
  // Usually prisma handles this by throwing P2003, which errorHandler will catch and return 500.
  // A better check would be explicitly seeing if it's used, but let's stick to existing behavior
  // handled by errorHandler for now.
  
  await prisma.category.delete({
    where: { id },
  });
  res.status(204).send();
}));

export default router;
