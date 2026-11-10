import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission, isRestrictedToOwn } from '../types';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';
import { REMINDER_STATUSES } from '../constants';

const router = Router();

// Require authentication for all reminders routes
router.use(requireAuth);

// GET /api/reminders
router.get('/', asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;

  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';
  const permitId = (req.query.permitId as string) || '';
  const contractId = (req.query.contractId as string) || '';
  const responsible = (req.query.responsible as string) || '';
  const dateFrom = (req.query.dateFrom as string) || '';
  const dateTo = (req.query.dateTo as string) || '';
  const dateField = (req.query.dateField as string) || 'dueDate';
  const excludeProjectId = (req.query.excludeProjectId as string) || '';
  const excludePermitId = (req.query.excludePermitId as string) || '';
  const excludeContractId = (req.query.excludeContractId as string) || '';
  const excludeIds = ((req.query.excludeIds as string) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const prioritizeClientId = (req.query.prioritizeClientId as string) || '';
  const prioritizeClientName = ((req.query.prioritizeClientName as string) || '').trim().toLowerCase();

  const conditions: any[] = [];

  const authUser = req.authUser!;
  const isOnlyOwn = isRestrictedToOwn(authUser, "reminders") || isRestrictedToOwn(authUser, "tracker_reminders");
  if (isOnlyOwn) {
    conditions.push({
      OR: [
        { responsibleId: authUser.id },
        ...(authUser.name ? [{ responsible: { equals: authUser.name, mode: 'insensitive' as const } }] : []),
      ],
    });
  }

  if (excludeProjectId) {
    conditions.push({ NOT: { projectId: excludeProjectId } });
  }
  if (excludePermitId) {
    conditions.push({ NOT: { permitId: excludePermitId } });
  }
  if (excludeContractId) {
    conditions.push({ NOT: { contractId: excludeContractId } });
  }
  if (excludeIds.length > 0) {
    conditions.push({ id: { notIn: excludeIds } });
  }

  // Status filtering
  if (status && status !== 'all') {
    if (status === REMINDER_STATUSES.OVERDUE) {
      const todayStr = new Date().toISOString().slice(0, 10);
      conditions.push({
        status: { not: REMINDER_STATUSES.COMPLETED },
        dueDate: { lt: todayStr },
      });
    } else if (status === 'approaching') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const in10DaysStr = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
      conditions.push({
        status: { not: REMINDER_STATUSES.COMPLETED },
        dueDate: { gte: todayStr, lte: in10DaysStr },
      });
    } else if (status === 'active' || status === 'not_completed') {
      conditions.push({ status: { not: REMINDER_STATUSES.COMPLETED } });
    } else {
      conditions.push({ status });
    }
  }

  if (clientId && clientId !== 'all') {
    conditions.push({
      OR: [
        { clientId: clientId },
        { clientName: { equals: clientId, mode: 'insensitive' as const } },
      ],
    });
  }
  if (projectId && projectId !== 'all') {
    conditions.push({ projectId });
  }
  if (permitId && permitId !== 'all') {
    conditions.push({ permitId });
  }
  if (contractId && contractId !== 'all') {
    conditions.push({ contractId });
  }
  if (responsible && responsible !== 'all') {
    conditions.push({
      OR: [
        { responsible: { contains: responsible, mode: 'insensitive' as const } },
        { responsibleId: responsible },
      ],
    });
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const field = dateField === 'createdAt' ? 'createdAt' : 'dueDate';
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = field === 'createdAt' ? new Date(dateFrom) : dateFrom;
    if (dateTo) dateFilter.lte = field === 'createdAt' ? new Date(dateTo) : dateTo;
    conditions.push({ [field]: dateFilter });
  }

  if (search) {
    conditions.push({
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { projectName: { contains: search, mode: 'insensitive' as const } },
        { clientName: { contains: search, mode: 'insensitive' as const } },
        { responsible: { contains: search, mode: 'insensitive' as const } },
        { status: { contains: search, mode: 'insensitive' as const } },
        { notes: { contains: search, mode: 'insensitive' as const } },
        { permitNumber: { contains: search, mode: 'insensitive' as const } },
        { contractNumber: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }

  const where: any = conditions.length > 1
    ? { AND: conditions }
    : (conditions[0] || {});

  const isSummary = req.query.fields === 'summary';

  const reminderInclude = {
    project: { select: { id: true, name: true, done: true } },
    client: { select: { id: true, name: true } },
    responsibleUser: { select: { id: true, name: true, email: true, gender: true } },
    permit: { select: { id: true, permitNumber: true } },
    contract: { select: { id: true, contractNumber: true, title: true } },
  };

  const reminderSummarySelect = {
    id: true,
    title: true,
    projectName: true,
    clientId: true,
    clientName: true,
    dueDate: true,
    permitId: true,
    permitNumber: true,
    contractId: true,
    contractNumber: true,
    isAutoContractReminder: true,
  };

  const queryOptions = isSummary
    ? { select: reminderSummarySelect }
    : { include: reminderInclude };

  // Unpaginated request
  if (!isPaginated) {
    const reminders = await prisma.reminder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(queryOptions as any),
    });
    res.json(reminders);
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: 'dueDate',
    defaultSortOrder: 'asc',
    maxLimit: 100,
  });

  const sortFieldMap: Record<string, string> = {
    dueDate: 'dueDate',
    title: 'title',
    project: 'projectName',
    projectName: 'projectName',
    client: 'clientName',
    clientName: 'clientName',
    responsible: 'responsible',
    status: 'status',
    createdAt: 'createdAt',
  };
  const sortField = sortFieldMap[pagination.sortBy] || 'dueDate';

  // If client prioritization is requested (e.g. linking to project or permit)
  if (prioritizeClientId || prioritizeClientName) {
    const allMatching = await prisma.reminder.findMany({
      where,
      ...(queryOptions as any),
    });

    const isMatchClient = (r: any) => {
      if (prioritizeClientId && r.clientId && r.clientId === prioritizeClientId) return true;
      if (prioritizeClientName && r.clientName && r.clientName.trim().toLowerCase() === prioritizeClientName) return true;
      return false;
    };

    allMatching.sort((a, b) => {
      const aClientMatch = isMatchClient(a);
      const bClientMatch = isMatchClient(b);
      if (aClientMatch && !bClientMatch) return -1;
      if (!aClientMatch && bClientMatch) return 1;

      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;

      const aTitle = a.title || a.projectName || '';
      const bTitle = b.title || b.projectName || '';
      return aTitle.localeCompare(bTitle);
    });

    const total = allMatching.length;
    const items = allMatching.slice(pagination.skip, (pagination.skip || 0) + (pagination.take || 10));
    res.json(buildPaginatedResponse(items, total, pagination));
    return;
  }

  const [total, items] = await Promise.all([
    prisma.reminder.count({ where }),
    prisma.reminder.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: pagination.sortOrder },
      ...(queryOptions as any),
    }),
  ]);

  res.json(buildPaginatedResponse(items, total, pagination));
}));

// POST /api/reminders
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'reminders', 'create') && !hasPermission(authUser, 'tracker_reminders', 'create')) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to create reminders.' });
    return;
  }

  const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate, permitId, permitNumber, contractId, contractNumber, isAutoContractReminder } = req.body;

  const finalTitle = title || projectName;
  if (!finalTitle) {
    res.status(400).json({ error: 'Reminder title or project name is required' });
    return;
  }

  const isOnlyOwn = isRestrictedToOwn(authUser, 'reminders') && isRestrictedToOwn(authUser, 'tracker_reminders');
  const finalResponsibleId = isOnlyOwn ? authUser.id : (responsibleId || null);
  const finalResponsible = isOnlyOwn ? (authUser.name || null) : (responsible || null);

  const reminder = await prisma.reminder.create({
    data: {
      title: finalTitle,
      projectId: projectId || null,
      projectName: projectName || null,
      clientId: clientId || null,
      clientName: clientName || null,
      responsibleId: finalResponsibleId,
      responsible: finalResponsible,
      status: status || REMINDER_STATUSES.PENDING,
      notes: notes || null,
      dueDate: dueDate || null,
      permitId: permitId || null,
      permitNumber: permitNumber || null,
      contractId: contractId || null,
      contractNumber: contractNumber || null,
      isAutoContractReminder: Boolean(isAutoContractReminder),
    },
  });

  res.status(201).json(reminder);
}));

// PUT /api/reminders/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate, permitId, permitNumber, contractId, contractNumber, isAutoContractReminder } = req.body;

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
      status: status !== undefined ? (status || REMINDER_STATUSES.PENDING) : existing.status,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      dueDate: dueDate !== undefined ? (dueDate || null) : existing.dueDate,
      permitId: permitId !== undefined ? (permitId || null) : existing.permitId,
      permitNumber: permitNumber !== undefined ? (permitNumber || null) : existing.permitNumber,
      contractId: contractId !== undefined ? (contractId || null) : existing.contractId,
      contractNumber: contractNumber !== undefined ? (contractNumber || null) : existing.contractNumber,
      isAutoContractReminder: isAutoContractReminder !== undefined ? Boolean(isAutoContractReminder) : existing.isAutoContractReminder,
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
    data: { status: status || REMINDER_STATUSES.COMPLETED },
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
