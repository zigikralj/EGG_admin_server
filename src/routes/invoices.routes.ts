import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { canManageInvoices } from '../types';

const router = Router();

// Require authentication for all invoice routes
router.use(requireAuth);

// GET /api/invoices
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';

  const where: any = {};
  if (status) {
    where.status = status;
  }
  if (clientId) {
    where.clientId = clientId;
  }
  if (projectId) {
    where.projectId = projectId;
  }
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { clientName: { contains: search, mode: 'insensitive' } },
      { projectName: { contains: search, mode: 'insensitive' } },
      { status: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { items: { some: { description: { contains: search, mode: 'insensitive' } } } }
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      client: true,
      project: true,
      items: true,
    },
  });

  res.json(invoices);
}));

// GET /api/invoices/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      project: true,
      items: true,
    },
  });

  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  res.json(invoice);
}));

// POST /api/invoices
router.post('/', asyncHandler(async (req, res) => {
  if (!canManageInvoices(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const {
    invoiceNumber,
    dateCreated,
    dueDate,
    paymentDate,
    clientId,
    clientName,
    projectId,
    projectName,
    status,
    notes,
    currency,
    items,
  } = req.body;

  if (!invoiceNumber || !String(invoiceNumber).trim()) {
    res.status(400).json({ error: 'Invoice number is required' });
    return;
  }

  let resolvedClientName = clientName || null;
  if (clientId && !resolvedClientName) {
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    if (c) resolvedClientName = c.name;
  }

  let resolvedProjectName = projectName || null;
  if (projectId && !resolvedProjectName) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    if (p) resolvedProjectName = p.name;
  }

  const itemsData = Array.isArray(items)
    ? items.map((item: any) => ({
        description: String(item.description || '').trim(),
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        currency: item.currency || currency || 'RSD',
      }))
    : [];

  const computedTotal = itemsData.reduce((sum: number, it: any) => sum + it.quantity * it.unitPrice, 0);

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: String(invoiceNumber).trim(),
      dateCreated: dateCreated || new Date().toISOString().slice(0, 10),
      dueDate: dueDate || null,
      paymentDate: paymentDate || null,
      clientId: clientId || null,
      clientName: resolvedClientName,
      projectId: projectId || null,
      projectName: resolvedProjectName,
      status: status || 'Draft',
      notes: notes || null,
      totalAmount: computedTotal,
      currency: currency || (itemsData.length > 0 ? itemsData[0].currency : 'RSD'),
      items: {
        create: itemsData,
      },
    },
    include: {
      client: true,
      project: true,
      items: true,
    },
  });

  res.status(201).json(invoice);
}));

// PUT /api/invoices/:id
router.put('/:id', asyncHandler(async (req, res) => {
  if (!canManageInvoices(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const id = req.params.id as string;
  const {
    invoiceNumber,
    dateCreated,
    dueDate,
    paymentDate,
    clientId,
    clientName,
    projectId,
    projectName,
    status,
    notes,
    currency,
    items,
  } = req.body;

  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  let resolvedClientName = clientName !== undefined ? clientName : existing.clientName;
  if (clientId && clientId !== existing.clientId && !clientName) {
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    if (c) resolvedClientName = c.name;
  }

  let resolvedProjectName = projectName !== undefined ? projectName : existing.projectName;
  if (projectId && projectId !== existing.projectId && !projectName) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    if (p) resolvedProjectName = p.name;
  }

  let itemsData: any[] | null = null;
  let computedTotal = existing.totalAmount;

  if (Array.isArray(items)) {
    itemsData = items.map((item: any) => ({
      description: String(item.description || '').trim(),
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      currency: item.currency || currency || existing.currency || 'RSD',
    }));
    computedTotal = itemsData.reduce((sum: number, it: any) => sum + it.quantity * it.unitPrice, 0);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (itemsData !== null) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      if (itemsData.length > 0) {
        await tx.invoiceItem.createMany({
          data: itemsData.map((item) => ({
            invoiceId: id,
            ...item,
          })),
        });
      }
    }

    return tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: invoiceNumber !== undefined ? String(invoiceNumber).trim() : existing.invoiceNumber,
        dateCreated: dateCreated !== undefined ? (dateCreated || null) : existing.dateCreated,
        dueDate: dueDate !== undefined ? (dueDate || null) : existing.dueDate,
        paymentDate: paymentDate !== undefined ? (paymentDate || null) : existing.paymentDate,
        clientId: clientId !== undefined ? (clientId || null) : existing.clientId,
        clientName: resolvedClientName,
        projectId: projectId !== undefined ? (projectId || null) : existing.projectId,
        projectName: resolvedProjectName,
        status: status || existing.status,
        notes: notes !== undefined ? (notes || null) : existing.notes,
        totalAmount: computedTotal,
        currency: currency !== undefined ? (currency || 'RSD') : existing.currency,
      },
      include: {
        client: true,
        project: true,
        items: true,
      },
    });
  });

  res.json(updated);
}));

// PATCH /api/invoices/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  if (!canManageInvoices(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const id = req.params.id as string;
  const { status, paymentDate } = req.body;

  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  const newStatus = status || existing.status;
  let resolvedPaymentDate = paymentDate !== undefined ? paymentDate : existing.paymentDate;
  if (newStatus === 'Paid' && !resolvedPaymentDate) {
    resolvedPaymentDate = new Date().toISOString().slice(0, 10);
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      status: newStatus,
      paymentDate: resolvedPaymentDate,
    },
    include: {
      client: true,
      project: true,
      items: true,
    },
  });

  res.json(updated);
}));

// DELETE /api/invoices/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!canManageInvoices(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const id = req.params.id as string;
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  await prisma.invoice.delete({ where: { id } });
  res.json({ message: 'Invoice deleted successfully' });
}));

export default router;
