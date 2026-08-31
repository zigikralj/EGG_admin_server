import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { UserRole } from '../types';

const router = Router();

// Require authentication for all clients routes
router.use(requireAuth);

// Helper to check if a role is Admin or Manager
function isAdminOrManager(role: string): boolean {
  return role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER;
}

// GET /api/clients
router.get('/', asyncHandler(async (_req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    include: { projects: true },
  });
  res.json(clients);
}));

// POST /api/clients
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    return;
  }

  const { name, contactPerson, email, phone, city } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }

  const trimmedName = name.trim();
  const existing = await prisma.client.findFirst({
    where: { name: { equals: trimmedName, mode: 'insensitive' } },
  });
  if (existing) {
    res.status(400).json({ error: 'A client with this name already exists' });
    return;
  }

  const client = await prisma.client.create({
    data: {
      name: trimmedName,
      contactPerson: contactPerson ? contactPerson.trim() : null,
      email: email ? email.trim() : null,
      phone: phone ? phone.trim() : null,
      city: city ? city.trim() : null,
    },
  });
  res.status(201).json(client);
}));

// PUT /api/clients/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    return;
  }

  const id = req.params.id as string;
  const { name, contactPerson, email, phone, city } = req.body;

  if (name && name.trim()) {
    const trimmedName = name.trim();
    const existing = await prisma.client.findFirst({
      where: {
        id: { not: id },
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      res.status(400).json({ error: 'A client with this name already exists' });
      return;
    }
  }

  const updated = await prisma.client.update({
    where: { id },
    data: {
      name: name ? name.trim() : undefined,
      contactPerson: contactPerson !== undefined ? (contactPerson ? contactPerson.trim() : null) : undefined,
      email: email !== undefined ? (email ? email.trim() : null) : undefined,
      phone: phone !== undefined ? (phone ? phone.trim() : null) : undefined,
      city: city !== undefined ? (city ? city.trim() : null) : undefined,
    },
  });
  res.json(updated);
}));

// DELETE /api/clients/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    return;
  }

  const id = req.params.id as string;
  await prisma.client.delete({ where: { id } });
  res.json({ message: 'Client deleted successfully' });
}));

export default router;
