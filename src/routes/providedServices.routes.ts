import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';
import { PROVIDED_SERVICE_STATUSES, SYSTEM_SETTING_KEYS } from '../constants';
import { getWasteDisposalStatistics, getWasteDisposalClients } from '../services/wasteStatistics.service';

async function getConfiguredWasteServiceId(): Promise<string | null> {
  const wasteSetting = await prisma.systemSetting.findUnique({ where: { key: SYSTEM_SETTING_KEYS.WASTE_DISPOSAL_SERVICE_ID } });
  const val = typeof wasteSetting?.value === 'string' ? wasteSetting.value.trim() : '';
  return val || null;
}

const router = Router();

// Require authentication for all provided services routes
router.use(requireAuth);

// GET /api/provided-services
router.get('/', asyncHandler(async (req, res) => {
  const canViewAll = hasPermission(req.authUser, 'providedServices', 'view');
  const canViewWaste = hasPermission(req.authUser, 'wasteDisposal', 'view');

  if (!canViewAll && !canViewWaste) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to view provided services.' });
    return;
  }

  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';
  const serviceId = (req.query.serviceId as string) || '';
  const invoiceId = (req.query.invoiceId as string) || '';
  const dateFrom = (req.query.dateFrom as string) || '';
  const dateTo = (req.query.dateTo as string) || '';
  const dateField = ((req.query.dateField as string) || 'scheduledDate').trim();
  const isWasteDisposalOnly = req.query.isWasteDisposalOnly === 'true' || req.query.wasteDisposalOnly === 'true';
  const missingInvoice = req.query.missingInvoice === 'true';

  const conditions: any[] = [];

  if (isWasteDisposalOnly || (!canViewAll && canViewWaste)) {
    const wasteServiceId = await getConfiguredWasteServiceId();
    if (!wasteServiceId) {
      const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
      if (!isPaginated) {
        res.json([]);
      } else {
        const pagination = parsePagination(req.query, {
          defaultSortBy: 'scheduledDate',
          defaultSortOrder: 'desc',
        });
        res.json(buildPaginatedResponse([], 0, pagination));
      }
      return;
    }
    conditions.push({ serviceId: wasteServiceId });
  }

  if (status && status !== 'all') {
    conditions.push({ status });
  }

  if (clientId && clientId !== 'all') {
    conditions.push({
      OR: [
        { clientId },
        { client: { name: { contains: clientId, mode: 'insensitive' } } },
      ],
    });
  }

  if (projectId && projectId !== 'all') {
    conditions.push({
      OR: [
        { projectId },
        { project: { name: { contains: projectId, mode: 'insensitive' } } },
      ],
    });
  }

  if (serviceId && serviceId !== 'all') {
    conditions.push({ serviceId });
  }

  if (invoiceId && invoiceId !== 'all') {
    conditions.push({ invoiceId });
  }

  if (missingInvoice) {
    conditions.push({ invoiceId: null });
  }

  if (dateFrom || dateTo) {
    const validDateFields = ['scheduledDate', 'completionDate', 'createdAt'];
    const field = validDateFields.includes(dateField) ? dateField : 'scheduledDate';
    const dateCond: any = {};
    if (field === 'createdAt') {
      if (dateFrom) dateCond.gte = new Date(dateFrom);
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        dateCond.lte = endOfDay;
      }
    } else {
      if (dateFrom) dateCond.gte = dateFrom;
      if (dateTo) dateCond.lte = dateTo;
    }
    conditions.push({ [field]: dateCond });
  }

  if (search) {
    conditions.push({
      OR: [
        { location: { contains: search, mode: 'insensitive' } },
        { status: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { service: { name: { contains: search, mode: 'insensitive' } } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { project: { name: { contains: search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }

  const where: any = conditions.length > 0 ? { AND: conditions } : {};

  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;

  const includeRelations = {
    service: { select: { id: true, code: true, name: true, group: true, frequency: true, customDataModel: true } },
    client: { select: { id: true, name: true, city: true } },
    project: { select: { id: true, name: true, done: true } },
    invoice: { select: { id: true, invoiceNumber: true, status: true } },
  };

  // Unpaginated request
  if (!isPaginated) {
    const rawItems = await prisma.providedService.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: includeRelations,
    });

    res.json(rawItems);
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: 'scheduledDate',
    defaultSortOrder: 'desc',
  });

  const sortFieldMap: Record<string, string> = {
    serviceName: 'service',
    clientName: 'client',
    projectName: 'project',
    invoiceNumber: 'invoice',
  };
  const sortBy = sortFieldMap[pagination.sortBy] || pagination.sortBy;

  let orderBy: any = { [sortBy]: pagination.sortOrder };
  if (sortBy === 'service') {
    orderBy = { service: { name: pagination.sortOrder } };
  } else if (sortBy === 'client') {
    orderBy = { client: { name: pagination.sortOrder } };
  } else if (sortBy === 'project') {
    orderBy = { project: { name: pagination.sortOrder } };
  } else if (sortBy === 'invoice') {
    orderBy = { invoice: { invoiceNumber: pagination.sortOrder } };
  }

  const [total, items] = await Promise.all([
    prisma.providedService.count({ where }),
    prisma.providedService.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy,
      include: includeRelations,
    }),
  ]);

  res.json(buildPaginatedResponse(items, total, pagination));
}));

// GET /api/provided-services/statistics/waste
router.get('/statistics/waste', asyncHandler(async (req, res) => {
  const canViewAll = hasPermission(req.authUser, 'providedServices', 'view');
  const canViewWaste = hasPermission(req.authUser, 'wasteDisposal', 'view');

  if (!canViewAll && !canViewWaste) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to view waste statistics.' });
    return;
  }

  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const monthIndex = req.query.monthIndex !== undefined ? parseInt(req.query.monthIndex as string, 10) : undefined;
  const statusFilter = (req.query.status as any) || 'all';

  const stats = await getWasteDisposalStatistics({
    year: !isNaN(year as number) ? year : undefined,
    monthIndex: !isNaN(monthIndex as number) ? monthIndex : undefined,
    statusFilter: ['all', 'completed', 'canceled'].includes(statusFilter) ? statusFilter : 'all',
  });

  res.json(stats);
}));

// GET /api/provided-services/statistics/waste/clients
router.get('/statistics/waste/clients', asyncHandler(async (req, res) => {
  const canViewAll = hasPermission(req.authUser, 'providedServices', 'view');
  const canViewWaste = hasPermission(req.authUser, 'wasteDisposal', 'view');

  if (!canViewAll && !canViewWaste) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to view waste statistics.' });
    return;
  }

  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
  const search = ((req.query.search as string) || '').trim();
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const statusFilter = (req.query.status as any) || 'all';
  const sortBy = (req.query.sortBy as any) || 'totalValue';
  const sortOrder = (req.query.sortOrder as any) || 'desc';

  const clientsData = await getWasteDisposalClients({
    page: !isNaN(page) ? page : 1,
    limit: !isNaN(limit) ? limit : 10,
    search,
    year: !isNaN(year as number) ? year : undefined,
    statusFilter: ['all', 'completed', 'canceled'].includes(statusFilter) ? statusFilter : 'all',
    sortBy: ['totalValue', 'totalWaste', 'count', 'clientName'].includes(sortBy) ? sortBy : 'totalValue',
    sortOrder: ['asc', 'desc'].includes(sortOrder.toLowerCase()) ? sortOrder.toLowerCase() : 'desc',
  });

  res.json(clientsData);
}));

// GET /api/provided-services/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const item = await prisma.providedService.findUnique({
    where: { id },
    include: {
      service: true,
      client: true,
      project: true,
      invoice: true,
    },
  });

  if (!item) {
    res.status(404).json({ error: 'Provided service not found' });
    return;
  }

  const wasteServiceId = await getConfiguredWasteServiceId();
  const isWaste = Boolean(wasteServiceId && item.serviceId === wasteServiceId);
  const canView =
    hasPermission(req.authUser, 'providedServices', 'view') ||
    (isWaste && hasPermission(req.authUser, 'wasteDisposal', 'view'));

  if (!canView) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  res.json(item);
}));

// POST /api/provided-services
router.post('/', asyncHandler(async (req, res) => {
  const {
    serviceId,
    clientId,
    projectId,
    invoiceId,
    status,
    location,
    scheduledDate,
    completionDate,
    notes,
    customData,
  } = req.body;

  if (!serviceId || !String(serviceId).trim()) {
    res.status(400).json({ error: 'Service is required' });
    return;
  }
  if (!clientId || !String(clientId).trim()) {
    res.status(400).json({ error: 'Client is required' });
    return;
  }

  // Verify service exists
  const serviceExists = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!serviceExists) {
    res.status(400).json({ error: 'Selected service does not exist' });
    return;
  }

  const wasteServiceId = await getConfiguredWasteServiceId();
  const isWaste = Boolean(wasteServiceId && serviceExists.id === wasteServiceId);
  const canCreate =
    hasPermission(req.authUser, 'providedServices', 'create') ||
    (isWaste && hasPermission(req.authUser, 'wasteDisposal', 'create'));

  if (!canCreate) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage provided services.' });
    return;
  }

  // Verify client exists
  const clientExists = await prisma.client.findUnique({ where: { id: clientId } });
  if (!clientExists) {
    res.status(400).json({ error: 'Selected client does not exist' });
    return;
  }

  if (projectId) {
    const projectExists = await prisma.project.findUnique({ where: { id: projectId } });
    if (!projectExists) {
      res.status(400).json({ error: 'Selected project does not exist' });
      return;
    }
  }

  if (invoiceId) {
    const invoiceExists = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoiceExists) {
      res.status(400).json({ error: 'Selected invoice does not exist' });
      return;
    }
  }

  const providedService = await prisma.providedService.create({
    data: {
      serviceId,
      clientId,
      projectId: projectId || null,
      invoiceId: invoiceId || null,
      status: status || PROVIDED_SERVICE_STATUSES.PLANNED,
      location: location ? String(location).trim() : null,
      scheduledDate: scheduledDate || null,
      completionDate: completionDate || null,
      notes: notes ? String(notes).trim() : null,
      customData: customData !== undefined ? customData : null,
    },
    include: {
      service: true,
      client: true,
      project: true,
      invoice: true,
    },
  });

  res.status(201).json(providedService);
}));

// PUT /api/provided-services/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const existing = await prisma.providedService.findUnique({
    where: { id },
    include: { service: true },
  });
  if (!existing) {
    res.status(404).json({ error: 'Provided service not found' });
    return;
  }

  const wasteServiceId = await getConfiguredWasteServiceId();
  const isWaste = Boolean(wasteServiceId && existing.serviceId === wasteServiceId);
  const canEdit =
    hasPermission(req.authUser, 'providedServices', 'edit') ||
    (isWaste && hasPermission(req.authUser, 'wasteDisposal', 'edit'));

  if (!canEdit) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage provided services.' });
    return;
  }

  const {
    serviceId,
    clientId,
    projectId,
    invoiceId,
    status,
    location,
    scheduledDate,
    completionDate,
    notes,
    customData,
  } = req.body;

  if (serviceId && serviceId !== existing.serviceId) {
    const serviceExists = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!serviceExists) {
      res.status(400).json({ error: 'Selected service does not exist' });
      return;
    }
  }

  if (clientId && clientId !== existing.clientId) {
    const clientExists = await prisma.client.findUnique({ where: { id: clientId } });
    if (!clientExists) {
      res.status(400).json({ error: 'Selected client does not exist' });
      return;
    }
  }

  if (projectId && projectId !== existing.projectId) {
    const projectExists = await prisma.project.findUnique({ where: { id: projectId } });
    if (!projectExists) {
      res.status(400).json({ error: 'Selected project does not exist' });
      return;
    }
  }

  if (invoiceId && invoiceId !== existing.invoiceId) {
    const invoiceExists = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoiceExists) {
      res.status(400).json({ error: 'Selected invoice does not exist' });
      return;
    }
  }

  const updated = await prisma.providedService.update({
    where: { id },
    data: {
      serviceId: serviceId !== undefined ? serviceId : existing.serviceId,
      clientId: clientId !== undefined ? clientId : existing.clientId,
      projectId: projectId !== undefined ? (projectId || null) : existing.projectId,
      invoiceId: invoiceId !== undefined ? (invoiceId || null) : existing.invoiceId,
      status: status !== undefined ? (status || PROVIDED_SERVICE_STATUSES.PLANNED) : existing.status,
      location: location !== undefined ? (location ? String(location).trim() : null) : existing.location,
      scheduledDate: scheduledDate !== undefined ? (scheduledDate || null) : existing.scheduledDate,
      completionDate: completionDate !== undefined ? (completionDate || null) : existing.completionDate,
      notes: notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes,
      customData: customData !== undefined ? customData : existing.customData,
    },
    include: {
      service: true,
      client: true,
      project: true,
      invoice: true,
    },
  });

  res.json(updated);
}));

// DELETE /api/provided-services/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const existing = await prisma.providedService.findUnique({
    where: { id },
    include: { service: true },
  });
  if (!existing) {
    res.status(404).json({ error: 'Provided service not found' });
    return;
  }

  const wasteServiceId = await getConfiguredWasteServiceId();
  const isWaste = Boolean(wasteServiceId && existing.serviceId === wasteServiceId);
  const canDelete =
    hasPermission(req.authUser, 'providedServices', 'delete') ||
    (isWaste && hasPermission(req.authUser, 'wasteDisposal', 'delete'));

  if (!canDelete) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage provided services.' });
    return;
  }

  await prisma.providedService.delete({ where: { id } });
  res.json({ message: 'Provided service deleted successfully' });
}));

export default router;
