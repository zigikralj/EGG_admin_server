import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { isAdminOrManager } from '../types';

const router = Router();

// Require authentication for all provided services routes
router.use(requireAuth);

// GET /api/provided-services
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';
  const serviceId = (req.query.serviceId as string) || '';
  const invoiceId = (req.query.invoiceId as string) || '';

  const where: any = {};
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  if (projectId) where.projectId = projectId;
  if (serviceId) where.serviceId = serviceId;
  if (invoiceId) where.invoiceId = invoiceId;

  if (search) {
    where.OR = [
      { location: { contains: search, mode: 'insensitive' } },
      { status: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { service: { name: { contains: search, mode: 'insensitive' } } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { project: { name: { contains: search, mode: 'insensitive' } } },
      { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const items = await prisma.providedService.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      service: true,
      client: true,
      project: true,
      invoice: true,
    },
  });

  res.json(items);
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

  res.json(item);
}));

// POST /api/provided-services
router.post('/', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
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
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage provided services.' });
    return;
  }
  const id = req.params.id as string;
  const existing = await prisma.providedService.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Provided service not found' });
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
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage provided services.' });
    return;
  }
  const id = req.params.id as string;
  const existing = await prisma.providedService.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Provided service not found' });
    return;
  }

  await prisma.providedService.delete({ where: { id } });
  res.json({ message: 'Provided service deleted successfully' });
}));

export default router;
