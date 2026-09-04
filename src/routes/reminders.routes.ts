import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { isAdminOrManager } from '../types';

const router = Router();

// Require authentication for all reminders routes
router.use(requireAuth);

// GET /api/reminders
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const where = search ? {
    OR: [
      { title: { contains: search, mode: 'insensitive' as const } },
      { projectName: { contains: search, mode: 'insensitive' as const } },
      { clientName: { contains: search, mode: 'insensitive' as const } },
      { responsible: { contains: search, mode: 'insensitive' as const } },
      { status: { contains: search, mode: 'insensitive' as const } },
      { notes: { contains: search, mode: 'insensitive' as const } },
    ]
  } : {};

  const reminders = await prisma.reminder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { project: true, client: true, responsibleUser: true, permit: true },
  });

  res.json(reminders);
}));

// POST /api/reminders
router.post('/', asyncHandler(async (req, res) => {
  const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate, permitId, permitNumber } = req.body;

  const finalTitle = title || projectName;
  if (!finalTitle) {
    res.status(400).json({ error: 'Reminder title or project name is required' });
    return;
  }

  const reminder = await prisma.reminder.create({
    data: {
      title: finalTitle,
      projectId: projectId || null,
      projectName: projectName || null,
      clientId: clientId || null,
      clientName: clientName || null,
      responsibleId: responsibleId || null,
      responsible: responsible || null,
      status: status || 'Pending',
      notes: notes || null,
      dueDate: dueDate || null,
      permitId: permitId || null,
      permitNumber: permitNumber || null,
    },
  });

  res.status(201).json(reminder);
}));

// PUT /api/reminders/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate, permitId, permitNumber } = req.body;

  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }

  if (!isAdminOrManager(req.authUser!.role) && existing.responsibleId !== req.authUser!.id) {
    res.status(403).json({ error: 'Permission denied. You can only manage your own reminders.' });
    return;
  }

  const updated = await prisma.reminder.update({
    where: { id },
    data: {
      title: title !== undefined ? (title || null) : existing.title,
      projectId: projectId !== undefined ? (projectId || null) : existing.projectId,
      projectName: projectName !== undefined ? (projectName || null) : existing.projectName,
      clientId: clientId !== undefined ? (clientId || null) : existing.clientId,
      clientName: clientName !== undefined ? (clientName || null) : existing.clientName,
      responsibleId: responsibleId !== undefined ? (responsibleId || null) : existing.responsibleId,
      responsible: responsible !== undefined ? (responsible || null) : existing.responsible,
      status: status || existing.status,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      dueDate: dueDate !== undefined ? (dueDate || null) : existing.dueDate,
      permitId: permitId !== undefined ? (permitId || null) : (existing as any).permitId,
      permitNumber: permitNumber !== undefined ? (permitNumber || null) : (existing as any).permitNumber,
    },
  });

  res.json(updated);
}));

// PATCH /api/reminders/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body;

  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }

  if (!isAdminOrManager(req.authUser!.role) && existing.responsibleId !== req.authUser!.id) {
    res.status(403).json({ error: 'Permission denied. You can only manage your own reminders.' });
    return;
  }

  const updated = await prisma.reminder.update({
    where: { id },
    data: { status: status || 'Completed' },
  });

  res.json(updated);
}));

// DELETE /api/reminders/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }
  
  if (!isAdminOrManager(req.authUser!.role) && existing.responsibleId !== req.authUser!.id) {
    res.status(403).json({ error: 'Permission denied. You can only manage your own reminders.' });
    return;
  }

  await prisma.reminder.delete({ where: { id } });
  res.json({ message: 'Reminder deleted successfully' });
}));

export default router;
