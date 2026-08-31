import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { UserRole } from '../types';

const router = Router();

// Require authentication for all services routes
router.use(requireAuth);

// Helper to check if a role is Admin or Manager
function isAdminOrManager(role: string): boolean {
  return role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER;
}

// GET /api/services
router.get('/', asyncHandler(async (_req, res) => {
  const services = await prisma.service.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(services);
}));

// POST /api/services
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
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
  res.status(201).json(service);
}));

// PUT /api/services/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
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
  res.json(updated);
}));

// DELETE /api/services/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
    return;
  }

  const id = req.params.id as string;
  await prisma.service.delete({ where: { id } });
  res.json({ message: 'Service deleted successfully' });
}));

export default router;
