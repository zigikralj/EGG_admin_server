import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parseSince, fetchDeletedIds, buildDeltaResponse } from '../helpers/deltaSync';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();

// Require authentication for all reminders routes
router.use(requireAuth);

// GET /api/reminders
router.get('/', asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const sinceDate = parseSince(req.query.since);

  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';
  const permitId = (req.query.permitId as string) || '';
  const responsible = (req.query.responsible as string) || '';
  const dateFrom = (req.query.dateFrom as string) || '';
  const dateTo = (req.query.dateTo as string) || '';
  const dateField = (req.query.dateField as string) || 'dueDate';

  const where: any = {};

  // Status filtering
  if (status && status !== 'all') {
    const todayStr = new Date().toISOString().slice(0, 10);
    const tenDaysFromNow = new Date();
    tenDaysFromNow.setDate(tenDaysFromNow.getDate() + 10);
    const in10DaysStr = tenDaysFromNow.toISOString().slice(0, 10);

    if (status === 'pending') {
      where.status = { in: ['Pending', 'U toku', 'Čeka se', 'Draft'] };
    } else if (status === 'completed') {
      where.status = { in: ['Completed', 'Završeno', 'Done'] };
    } else if (status === 'overdue') {
      where.status = { notIn: ['Completed', 'Završeno', 'Done'] };
      where.dueDate = { lt: todayStr };
    } else if (status === 'approaching') {
      where.status = { notIn: ['Completed', 'Završeno', 'Done'] };
      where.dueDate = { gte: todayStr, lte: in10DaysStr };
    } else {
      where.status = { equals: status, mode: 'insensitive' };
    }
  }

  if (clientId && clientId !== 'all') {
    where.clientId = clientId;
  }
  if (projectId && projectId !== 'all') {
    where.projectId = projectId;
  }
  if (permitId && permitId !== 'all') {
    where.permitId = permitId;
  }
  if (responsible && responsible !== 'all') {
    where.OR = [
      { responsible: { contains: responsible, mode: 'insensitive' } },
      { responsibleId: responsible },
    ];
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const field = dateField === 'createdAt' ? 'createdAt' : 'dueDate';
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = field === 'createdAt' ? new Date(dateFrom) : dateFrom;
    if (dateTo) dateFilter.lte = field === 'createdAt' ? new Date(dateTo) : dateTo;
    where[field] = dateFilter;
  }

  if (search) {
    const searchConditions = [
      { title: { contains: search, mode: 'insensitive' as const } },
      { projectName: { contains: search, mode: 'insensitive' as const } },
      { clientName: { contains: search, mode: 'insensitive' as const } },
      { responsible: { contains: search, mode: 'insensitive' as const } },
      { status: { contains: search, mode: 'insensitive' as const } },
      { notes: { contains: search, mode: 'insensitive' as const } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  const reminderInclude = {
    project: { select: { id: true, name: true, done: true } },
    client: { select: { id: true, name: true } },
    responsibleUser: { select: { id: true, name: true, email: true, gender: true } },
    permit: { select: { id: true, permitNumber: true } },
  };

  // If delta sync requested or unpaginated request, preserve legacy / delta sync envelope
  if (sinceDate || !isPaginated) {
    if (sinceDate) {
      where.updatedAt = { gt: sinceDate };
    }
    const [reminders, deletedIds] = await Promise.all([
      prisma.reminder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: reminderInclude,
      }),
      sinceDate ? fetchDeletedIds('Reminder', sinceDate) : Promise.resolve([]),
    ]);
    res.json(buildDeltaResponse(reminders, deletedIds, sinceDate));
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: 'dueDate',
    defaultSortOrder: 'asc',
    maxLimit: 100,
  });

  const validSortFields = ['dueDate', 'title', 'projectName', 'clientName', 'responsible', 'status', 'createdAt'];
  const sortField = validSortFields.includes(pagination.sortBy) ? pagination.sortBy : 'dueDate';

  const [total, items] = await Promise.all([
    prisma.reminder.count({ where }),
    prisma.reminder.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: pagination.sortOrder },
      include: reminderInclude,
    }),
  ]);

  res.json(buildPaginatedResponse(items, total, pagination));
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

  const canEditReminder = hasPermission(req.authUser, "reminders", "edit") || hasPermission(req.authUser, "tracker_reminders", "edit");
  if (!canEditReminder && existing.responsibleId !== req.authUser!.id) {
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
      permitId: permitId !== undefined ? (permitId || null) : existing.permitId,
      permitNumber: permitNumber !== undefined ? (permitNumber || null) : existing.permitNumber,
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

  const canEditReminder = hasPermission(req.authUser, "reminders", "edit") || hasPermission(req.authUser, "tracker_reminders", "edit");
  if (!canEditReminder && existing.responsibleId !== req.authUser!.id) {
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
  
  const canDeleteReminder = hasPermission(req.authUser, "reminders", "delete") || hasPermission(req.authUser, "tracker_reminders", "delete");
  if (!canDeleteReminder && existing.responsibleId !== req.authUser!.id) {
    res.status(403).json({ error: 'Permission denied. You can only manage your own reminders.' });
    return;
  }

  await prisma.reminder.delete({ where: { id } });
  res.json({ message: 'Reminder deleted successfully' });
}));

export default router;
