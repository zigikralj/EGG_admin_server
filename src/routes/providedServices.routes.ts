import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parseSince, fetchDeletedIds, buildDeltaResponse } from '../helpers/deltaSync';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

function isWasteDisposalService(srv?: { code?: string | null; name?: string | null } | null): boolean {
  if (!srv) return false;
  const code = (srv.code || "").toLowerCase().trim();
  const name = (srv.name || "").toLowerCase().trim();
  return (
    code === "waste-disposal" ||
    code === "zbrinjavanje" ||
    code === "zbrinjavanje-otpada" ||
    code === "odlaganje" ||
    code === "odlaganje-otpada" ||
    code.includes("disposal") ||
    code.includes("zbrinjavanje") ||
    code.includes("odlaganje") ||
    name === "waste disposal" ||
    name === "zbrinjavanje otpada" ||
    name === "збрињавање отпада" ||
    name === "odlaganje otpada" ||
    name === "одлагање отпада" ||
    name.includes("disposal") ||
    name.includes("zbrinjavanje") ||
    name.includes("збрињавање") ||
    name.includes("odlaganje") ||
    name.includes("одлагање")
  );
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
    conditions.push({
      service: {
        OR: [
          { code: { in: ['waste-disposal', 'zbrinjavanje', 'zbrinjavanje-otpada', 'odlaganje', 'odlaganje-otpada'] } },
          { code: { contains: 'disposal', mode: 'insensitive' } },
          { code: { contains: 'zbrinjavanje', mode: 'insensitive' } },
          { code: { contains: 'odlaganje', mode: 'insensitive' } },
          { name: { contains: 'disposal', mode: 'insensitive' } },
          { name: { contains: 'zbrinjavanje', mode: 'insensitive' } },
          { name: { contains: 'збрињавање', mode: 'insensitive' } },
          { name: { contains: 'odlaganje', mode: 'insensitive' } },
          { name: { contains: 'одлагање', mode: 'insensitive' } },
        ],
      },
    });
  }

  if (status && status !== 'all') {
    const s = status.toLowerCase();
    if (s === 'planned' || s === 'planirano' || s === 'планирано') {
      conditions.push({
        status: { in: ['Planned', 'planirano', 'планирано', 'planned'], mode: 'insensitive' },
      });
    } else if (s === 'in progress' || s === 'in_progress' || s === 'u toku' || s === 'у току') {
      conditions.push({
        status: { in: ['In Progress', 'in_progress', 'u toku', 'у току', 'in progress'], mode: 'insensitive' },
      });
    } else if (s === 'completed' || s === 'završeno' || s === 'завршено') {
      conditions.push({
        status: { in: ['Completed', 'završeno', 'завршено', 'completed'], mode: 'insensitive' },
      });
    } else if (s === 'cancelled' || s === 'otkazano' || s === 'отказано') {
      conditions.push({
        status: { in: ['Cancelled', 'otkazano', 'отказано', 'cancelled'], mode: 'insensitive' },
      });
    } else {
      conditions.push({
        status: { equals: status, mode: 'insensitive' },
      });
    }
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
    if (dateFrom) dateCond.gte = new Date(dateFrom);
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      dateCond.lte = endOfDay;
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

  const sinceDate = parseSince(req.query.since);
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;

  const includeRelations = {
    service: { select: { id: true, code: true, name: true, group: true, frequency: true, customDataModel: true } },
    client: { select: { id: true, name: true, city: true } },
    project: { select: { id: true, name: true, done: true } },
    invoice: { select: { id: true, invoiceNumber: true, status: true } },
  };

  // Delta sync or unpaginated request
  if (sinceDate || !isPaginated) {
    if (sinceDate) {
      where.updatedAt = { gt: sinceDate };
    }
    const [rawItems, deletedIds] = await Promise.all([
      prisma.providedService.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      }),
      sinceDate ? fetchDeletedIds('ProvidedService', sinceDate) : Promise.resolve([]),
    ]);

    let items = rawItems;
    if (!canViewAll && canViewWaste) {
      items = items.filter((item) => isWasteDisposalService(item.service));
    }

    res.json(buildDeltaResponse(items, deletedIds, sinceDate));
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: 'scheduledDate',
    defaultSortOrder: 'desc',
    maxLimit: 100,
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

  const isWaste = isWasteDisposalService(item.service);
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
    price,
    currency,
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

  const isWaste = isWasteDisposalService(serviceExists);
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
      status: status || 'Planned',
      location: location ? String(location).trim() : null,
      scheduledDate: scheduledDate || null,
      completionDate: completionDate || null,
      price: price !== undefined && price !== null ? Number(price) : 0,
      currency: currency || 'RSD',
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

  const isWaste = isWasteDisposalService(existing.service);
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
    price,
    currency,
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
      status: status !== undefined ? status : existing.status,
      location: location !== undefined ? (location ? String(location).trim() : null) : existing.location,
      scheduledDate: scheduledDate !== undefined ? (scheduledDate || null) : existing.scheduledDate,
      completionDate: completionDate !== undefined ? (completionDate || null) : existing.completionDate,
      price: price !== undefined && price !== null ? Number(price) : existing.price,
      currency: currency !== undefined ? currency : existing.currency,
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

  const isWaste = isWasteDisposalService(existing.service);
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
