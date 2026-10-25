import { Router } from 'express';
import { prisma, auditedTransaction } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';
import { parseSince, fetchDeletedIds, buildDeltaResponse } from '../helpers/deltaSync';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();

// Require authentication for all invoice routes
router.use(requireAuth);

// GET /api/invoices
router.get('/', asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const sinceDate = parseSince(req.query.since);

  const search = ((req.query.search as string) || '').trim();
  const status = (req.query.status as string) || '';
  const clientId = (req.query.clientId as string) || '';
  const projectId = (req.query.projectId as string) || '';
  const currency = (req.query.currency as string) || '';
  const invoiceType = (req.query.invoiceType as string) || '';
  const linkedStatus = (req.query.linkedStatus as string) || '';
  const dateFrom = (req.query.dateFrom as string) || '';
  const dateTo = (req.query.dateTo as string) || '';
  const dateField = (req.query.dateField as string) || 'dateCreated';

  const where: any = {};
  if (status && status !== 'all') {
    if (status === 'unpaid') {
      where.status = { notIn: ['Paid', 'Cancelled'] };
    } else {
      where.status = status;
    }
  }
  if (clientId && clientId !== 'all') {
    where.clientId = clientId;
  }
  if (projectId && projectId !== 'all') {
    where.projectId = projectId;
  }
  if (currency && currency !== 'all') {
    where.currency = currency;
  }
  if (invoiceType && invoiceType !== 'all') {
    if (invoiceType === 'Standard') {
      where.OR = [
        { invoiceType: 'Standard' },
        { invoiceType: null },
      ];
    } else {
      where.invoiceType = invoiceType;
    }
  }
  if (linkedStatus && linkedStatus !== 'all') {
    if (linkedStatus === 'linked') {
      where.OR = [
        { parentInvoiceId: { not: null } },
        { childInvoices: { some: {} } },
      ];
    } else if (linkedStatus === 'independent') {
      where.parentInvoiceId = null;
      where.childInvoices = { none: {} };
    }
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const field = ['dueDate', 'paymentDate', 'dateCreated', 'createdAt'].includes(dateField)
      ? dateField
      : 'dateCreated';
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = field === 'createdAt' ? new Date(dateFrom) : dateFrom;
    if (dateTo) dateFilter.lte = field === 'createdAt' ? new Date(dateTo) : dateTo;
    where[field] = dateFilter;
  }

  if (search) {
    const searchConditions = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { clientName: { contains: search, mode: 'insensitive' } },
      { projectName: { contains: search, mode: 'insensitive' } },
      { status: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { items: { some: { description: { contains: search, mode: 'insensitive' } } } },
      { parentInvoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      { childInvoices: { some: { invoiceNumber: { contains: search, mode: 'insensitive' } } } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  const invoiceInclude = {
    client: { select: { id: true, name: true } },
    project: { select: { id: true, name: true, done: true } },
    parentInvoice: { select: { id: true, invoiceNumber: true, invoiceType: true } },
    childInvoices: { select: { id: true, invoiceNumber: true, invoiceType: true } },
    items: true,
  };

  // If delta sync requested or unpaginated request, preserve legacy / delta sync envelope
  if (sinceDate || !isPaginated) {
    if (sinceDate) {
      where.updatedAt = { gt: sinceDate };
    }
    const [invoices, deletedIds] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: invoiceInclude,
      }),
      sinceDate ? fetchDeletedIds('Invoice', sinceDate) : Promise.resolve([]),
    ]);
    res.json(buildDeltaResponse(invoices, deletedIds, sinceDate));
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: 'dateCreated',
    defaultSortOrder: 'desc',
    maxLimit: 100,
  });

  const validSortFields = [
    'dateCreated',
    'dueDate',
    'paymentDate',
    'invoiceNumber',
    'clientName',
    'projectName',
    'status',
    'totalAmount',
    'invoiceType',
    'createdAt',
  ];
  const sortField = validSortFields.includes(pagination.sortBy) ? pagination.sortBy : 'dateCreated';

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: pagination.sortOrder },
      include: invoiceInclude,
    }),
  ]);

  res.json(buildPaginatedResponse(items, total, pagination));
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
  if (!hasPermission(req.authUser, "invoices", "create") && !hasPermission(req.authUser, "tracker_invoices", "create")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const {
    invoiceNumber,
    invoiceType,
    parentInvoiceId,
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
      invoiceType: invoiceType || 'Standard',
      parentInvoiceId: parentInvoiceId || null,
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
  if (!hasPermission(req.authUser, "invoices", "edit") && !hasPermission(req.authUser, "tracker_invoices", "edit")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage invoices.' });
    return;
  }
  const id = req.params.id as string;
  const {
    invoiceNumber,
    invoiceType,
    parentInvoiceId,
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

  let computedTotal = existing.totalAmount;
  if (Array.isArray(items)) {
    computedTotal = items.reduce(
      (sum: number, it: any) => sum + (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
      0
    );
  }

  const updated = await auditedTransaction(async (tx) => {
    if (Array.isArray(items)) {
      const incomingItemIds = new Set(
        items.filter((it: any) => Boolean(it.id)).map((it: any) => String(it.id))
      );
      const existingItemIds = new Set(existing.items.map((it) => it.id));

      // 1. Delete items present in DB but missing from payload
      const toDeleteIds = existing.items
        .filter((it) => !incomingItemIds.has(it.id))
        .map((it) => it.id);

      if (toDeleteIds.length > 0) {
        await tx.invoiceItem.deleteMany({
          where: { id: { in: toDeleteIds } },
        });
      }

      // 2. Update existing items or insert new items
      for (const item of items) {
        const itemData = {
          description: String(item.description || '').trim(),
          quantity: Number(item.quantity) || 1,
          unitPrice: Number(item.unitPrice) || 0,
          currency: item.currency || currency || existing.currency || 'RSD',
        };

        if (item.id && existingItemIds.has(String(item.id))) {
          await tx.invoiceItem.update({
            where: { id: String(item.id) },
            data: itemData,
          });
        } else {
          await tx.invoiceItem.create({
            data: {
              ...itemData,
              invoiceId: id,
            },
          });
        }
      }
    }

    return tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: invoiceNumber !== undefined ? String(invoiceNumber).trim() : existing.invoiceNumber,
        invoiceType: invoiceType !== undefined ? invoiceType : existing.invoiceType,
        parentInvoiceId: parentInvoiceId !== undefined ? parentInvoiceId : existing.parentInvoiceId,
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
  if (!hasPermission(req.authUser, "invoices", "edit") && !hasPermission(req.authUser, "tracker_invoices", "edit")) {
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
  if (!hasPermission(req.authUser, "invoices", "delete") && !hasPermission(req.authUser, "tracker_invoices", "delete")) {
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
