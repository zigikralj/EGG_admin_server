import { Router } from 'express';
import { prisma, auditedTransaction } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();
router.use(requireAuth);

/**
 * Calculates a reminder date 45 days before the provided endDate string (YYYY-MM-DD).
 */
export function calculate45DayReminderDate(endDateStr: string | null | undefined): string | null {
  if (!endDateStr) return null;
  const match = endDateStr.split('T')[0];
  const dateObj = new Date(match);
  if (isNaN(dateObj.getTime())) return null;

  // Subtract 45 days (45 * 24 * 60 * 60 * 1000)
  const reminderDateObj = new Date(dateObj.getTime() - 45 * 24 * 60 * 60 * 1000);
  return reminderDateObj.toISOString().slice(0, 10);
}

/**
 * Syncs the automatic 45-day reminder for a contract inside a transaction.
 */
export async function syncContractAutoReminder(
  tx: any,
  contract: {
    id: string;
    contractNumber: string;
    title: string;
    endDate?: string | null;
    clientId: string;
    clientName: string;
    projectId?: string | null;
    projectName?: string | null;
    responsibleId?: string | null;
    responsible?: string | null;
  }
) {
  const reminderDueDate = calculate45DayReminderDate(contract.endDate);

  const existingAuto = await tx.reminder.findFirst({
    where: {
      contractId: contract.id,
      isAutoContractReminder: true,
    },
  });

  if (!reminderDueDate) {
    // If contract has no endDate, delete any pending auto-reminder
    if (existingAuto && existingAuto.status === 'Pending') {
      await tx.reminder.delete({ where: { id: existingAuto.id } });
    }
    return;
  }

  const reminderTitle = `Istek ugovora (45d): ${contract.contractNumber} - ${contract.title}`;

  if (existingAuto) {
    await tx.reminder.update({
      where: { id: existingAuto.id },
      data: {
        title: reminderTitle,
        dueDate: reminderDueDate,
        clientId: contract.clientId,
        clientName: contract.clientName,
        projectId: contract.projectId || null,
        projectName: contract.projectName || null,
        responsibleId: contract.responsibleId || null,
        responsible: contract.responsible || null,
        contractNumber: contract.contractNumber,
        // If contract endDate was extended/updated and existing reminder was completed/cancelled, reset to Pending
        status: existingAuto.dueDate !== reminderDueDate && existingAuto.status === 'Completed'
          ? 'Pending'
          : existingAuto.status,
      },
    });
  } else {
    await tx.reminder.create({
      data: {
        title: reminderTitle,
        dueDate: reminderDueDate,
        clientId: contract.clientId,
        clientName: contract.clientName,
        projectId: contract.projectId || null,
        projectName: contract.projectName || null,
        responsibleId: contract.responsibleId || null,
        responsible: contract.responsible || null,
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        isAutoContractReminder: true,
        status: 'Pending',
        notes: `Automatski podsetnik kreiran za ugovor ${contract.contractNumber} (45 dana pre isteka: ${contract.endDate}).`,
      },
    });
  }
}

// GET /api/contracts
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const status = ((req.query.status as string) || '').trim();
  const clientId = ((req.query.clientId as string) || '').trim();
  const projectId = ((req.query.projectId as string) || '').trim();
  const responsibleId = ((req.query.responsibleId as string) || '').trim();
  const dateFrom = ((req.query.dateFrom as string) || '').trim();
  const dateTo = ((req.query.dateTo as string) || '').trim();
  const dateField = req.query.dateField === 'startDate' ? 'startDate' : 'endDate';

  const conditions: any[] = [];

  if (search) {
    conditions.push({
      OR: [
        { contractNumber: { contains: search, mode: 'insensitive' as const } },
        { title: { contains: search, mode: 'insensitive' as const } },
        { clientName: { contains: search, mode: 'insensitive' as const } },
        { projectName: { contains: search, mode: 'insensitive' as const } },
        { responsible: { contains: search, mode: 'insensitive' as const } },
        { notes: { contains: search, mode: 'insensitive' as const } },
      ],
    });
  }

  // Status filter (active | expiring | expired | draft | terminated)
  if (status && status !== 'all') {
    const today = new Date().toISOString().slice(0, 10);
    const in45Days = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (status === 'active') {
      conditions.push({
        status: 'Active',
        OR: [
          { endDate: { gte: today } },
          { endDate: null },
        ],
      });
    } else if (status === 'expiring') {
      conditions.push({
        status: 'Active',
        endDate: { gte: today, lte: in45Days },
      });
    } else if (status === 'expired') {
      conditions.push({
        OR: [
          { status: 'Expired' },
          { status: 'Active', endDate: { lt: today } },
        ],
      });
    } else {
      conditions.push({ status });
    }
  }

  if (clientId && clientId !== 'all') {
    conditions.push({ clientId });
  }

  if (projectId && projectId !== 'all') {
    conditions.push({ projectId });
  }

  if (responsibleId && responsibleId !== 'all') {
    conditions.push({ responsibleId });
  }

  if (dateFrom || dateTo) {
    const dateCondition: any = {};
    if (dateFrom) dateCondition.gte = dateFrom;
    if (dateTo) dateCondition.lte = dateTo;
    conditions.push({ [dateField]: dateCondition });
  }

  const where: any = conditions.length > 1
    ? { AND: conditions }
    : (conditions[0] || {});

  // Sorting
  const sortBy = ((req.query.sortBy as string) || 'endDate').trim();
  const sortOrder = ((req.query.sortOrder as string) || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  let orderBy: any;
  if (sortBy === 'startDate') {
    orderBy = { startDate: sortOrder };
  } else if (sortBy === 'contractNumber') {
    orderBy = { contractNumber: sortOrder };
  } else if (sortBy === 'title') {
    orderBy = { title: sortOrder };
  } else if (sortBy === 'clientName') {
    orderBy = { clientName: sortOrder };
  } else if (sortBy === 'status') {
    orderBy = { status: sortOrder };
  } else if (sortBy === 'createdAt') {
    orderBy = { createdAt: sortOrder };
  } else {
    orderBy = { endDate: sortOrder };
  }

  const pagination = parsePagination(req.query, 25);

  if (req.query.fields === 'summary') {
    const summarySelect = {
      id: true,
      contractNumber: true,
      title: true,
      clientId: true,
      clientName: true,
      startDate: true,
      endDate: true,
      status: true,
    };

    if (pagination.isPaginated) {
      const [total, contracts] = await Promise.all([
        prisma.contract.count({ where }),
        prisma.contract.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
          select: summarySelect,
        }),
      ]);
      res.json(buildPaginatedResponse(contracts, total, pagination.page, pagination.limit));
      return;
    }

    const contracts = await prisma.contract.findMany({
      where,
      orderBy,
      select: summarySelect,
    });
    res.json(contracts);
    return;
  }

  const contractInclude = {
    client: { select: { id: true, name: true, city: true, email: true, phone: true } },
    project: { select: { id: true, name: true } },
    responsibleUser: { select: { id: true, name: true, email: true } },
    reminders: {
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        notes: true,
        isAutoContractReminder: true,
      },
      orderBy: { dueDate: 'asc' as const },
    },
  };

  if (pagination.isPaginated) {
    const [total, contracts] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        include: contractInclude,
      }),
    ]);
    res.json(buildPaginatedResponse(contracts, total, pagination.page, pagination.limit));
    return;
  }

  const contracts = await prisma.contract.findMany({
    where,
    orderBy,
    include: contractInclude,
  });

  res.json(contracts);
}));

// GET /api/contracts/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      client: true,
      project: true,
      responsibleUser: true,
      reminders: {
        orderBy: { dueDate: 'asc' },
      },
    },
  });

  if (!contract) {
    res.status(404).json({ error: 'Ugovor nije pronađen.' });
    return;
  }

  res.json(contract);
}));

// POST /api/contracts
router.post('/', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'create')) {
    res.status(403).json({ error: 'Nemate dozvolu za kreiranje ugovora.' });
    return;
  }

  const {
    contractNumber,
    title,
    clientId,
    clientName,
    projectId,
    projectName,
    responsibleId,
    responsible,
    startDate,
    endDate,
    status = 'Draft',
    content,
    notes,
  } = req.body;

  if (!contractNumber || !contractNumber.trim()) {
    res.status(400).json({ error: 'Broj ugovora je obavezan.' });
    return;
  }

  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Naziv/predmet ugovora je obavezan.' });
    return;
  }

  if (!clientId || !String(clientId).trim()) {
    res.status(400).json({ error: 'Klijent je obavezan.' });
    return;
  }

  // Resolve clientName if missing
  let resolvedClientName = clientName ? clientName.trim() : '';
  if (!resolvedClientName) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    resolvedClientName = client?.name || 'Nepoznat klijent';
  }

  // Resolve projectName if projectId is given
  let resolvedProjectName = projectName ? projectName.trim() : null;
  if (projectId && !resolvedProjectName) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    resolvedProjectName = project?.name || null;
  }

  // Resolve responsible name if responsibleId is given
  let resolvedResponsible = responsible ? responsible.trim() : null;
  if (responsibleId && !resolvedResponsible) {
    const user = await prisma.user.findUnique({ where: { id: responsibleId } });
    resolvedResponsible = user?.name || null;
  }

  const contract = await auditedTransaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        contractNumber: contractNumber.trim(),
        title: title.trim(),
        clientId: String(clientId).trim(),
        clientName: resolvedClientName,
        projectId: projectId || null,
        projectName: resolvedProjectName,
        responsibleId: responsibleId || null,
        responsible: resolvedResponsible,
        startDate: startDate ? startDate.slice(0, 10) : null,
        endDate: endDate ? endDate.slice(0, 10) : null,
        status: status || 'Draft',
        content: content || null,
        notes: notes ? notes.trim() : null,
      },
      include: {
        client: true,
        project: true,
        responsibleUser: true,
        reminders: true,
      },
    });

    // Auto sync 45-day reminder
    await syncContractAutoReminder(tx, created);

    return created;
  });

  // Re-fetch with reminders
  const result = await prisma.contract.findUnique({
    where: { id: contract.id },
    include: {
      client: true,
      project: true,
      responsibleUser: true,
      reminders: { orderBy: { dueDate: 'asc' } },
    },
  });

  res.status(201).json(result);
}));

// PUT /api/contracts/:id
router.put('/:id', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'edit')) {
    res.status(403).json({ error: 'Nemate dozvolu za izmenu ugovora.' });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Ugovor nije pronađen.' });
    return;
  }

  const {
    contractNumber,
    title,
    clientId,
    clientName,
    projectId,
    projectName,
    responsibleId,
    responsible,
    startDate,
    endDate,
    status,
    content,
    notes,
  } = req.body;

  let targetClientId = existing.clientId;
  let targetClientName = existing.clientName;
  if (clientId !== undefined) {
    if (!clientId || !String(clientId).trim()) {
      res.status(400).json({ error: 'Klijent je obavezan.' });
      return;
    }
    targetClientId = String(clientId).trim();
    if (clientName) {
      targetClientName = clientName.trim();
    } else {
      const client = await prisma.client.findUnique({ where: { id: targetClientId } });
      targetClientName = client?.name || existing.clientName;
    }
  }

  let targetProjectId = existing.projectId;
  let targetProjectName = existing.projectName;
  if (projectId !== undefined) {
    targetProjectId = projectId || null;
    if (targetProjectId) {
      if (projectName) {
        targetProjectName = projectName.trim();
      } else {
        const project = await prisma.project.findUnique({ where: { id: targetProjectId } });
        targetProjectName = project?.name || null;
      }
    } else {
      targetProjectName = null;
    }
  }

  let targetResponsibleId = existing.responsibleId;
  let targetResponsible = existing.responsible;
  if (responsibleId !== undefined) {
    targetResponsibleId = responsibleId || null;
    if (targetResponsibleId) {
      if (responsible) {
        targetResponsible = responsible.trim();
      } else {
        const user = await prisma.user.findUnique({ where: { id: targetResponsibleId } });
        targetResponsible = user?.name || null;
      }
    } else {
      targetResponsible = null;
    }
  }

  await auditedTransaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id },
      data: {
        contractNumber: contractNumber !== undefined ? contractNumber.trim() : existing.contractNumber,
        title: title !== undefined ? title.trim() : existing.title,
        clientId: targetClientId,
        clientName: targetClientName,
        projectId: targetProjectId,
        projectName: targetProjectName,
        responsibleId: targetResponsibleId,
        responsible: targetResponsible,
        startDate: startDate !== undefined ? (startDate ? startDate.slice(0, 10) : null) : existing.startDate,
        endDate: endDate !== undefined ? (endDate ? endDate.slice(0, 10) : null) : existing.endDate,
        status: status !== undefined ? status : existing.status,
        content: content !== undefined ? content : existing.content,
        notes: notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      },
    });

    // Auto sync 45-day reminder
    await syncContractAutoReminder(tx, updated);
  });

  const result = await prisma.contract.findUnique({
    where: { id },
    include: {
      client: true,
      project: true,
      responsibleUser: true,
      reminders: { orderBy: { dueDate: 'asc' } },
    },
  });

  res.json(result);
}));

// DELETE /api/contracts/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'contracts', 'delete')) {
    res.status(403).json({ error: 'Nemate dozvolu za brisanje ugovora.' });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Ugovor nije pronađen.' });
    return;
  }

  await auditedTransaction(async (tx) => {
    // Delete connected reminders
    await tx.reminder.deleteMany({
      where: { contractId: id },
    });

    await tx.contract.delete({
      where: { id },
    });
  });

  res.json({ message: 'Ugovor je uspešno obrisan.' });
}));

export default router;
