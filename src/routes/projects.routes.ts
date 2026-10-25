import { Router } from 'express';
import { prisma, basePrisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission, isRestrictedToOwn } from '../types';
import { handleProjectNotesMentions } from '../helpers/mentionHelper';
import {
  saveNoteRevision,
  getNoteRevisionsList,
  diffNoteVersions,
  resolveNoteVersionsByDate,
  restoreNoteVersion,
  stripHtmlToText,
} from '../services/noteDelta.service';
import {
  resolveVersionsByDate,
  diffVersions,
} from '../services/versioning.service';
import {
  parseSince,
  fetchDeletedIds,
  buildDeltaResponse,
} from '../helpers/deltaSync';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();

// Require authentication for all projects routes
router.use(requireAuth);

// Helper to check if a user is the owner of a project or an admin/manager
function isProjectOwnerOrCan(
  user: any,
  project: { responsible?: string | null; responsibleId?: string | null },
  action: "view" | "edit" | "delete"
): boolean {
  if (user.role === "Administrator" || user.roleEntity?.isSystemAdmin) return true;
  const isOwner = Boolean(
    (project.responsible && project.responsible.trim().toLowerCase() === (user.name || "").trim().toLowerCase()) ||
    (project.responsibleId && project.responsibleId === user.id)
  );
  if (isRestrictedToOwn(user, "projects") || isRestrictedToOwn(user, "tracker_projects") || isRestrictedToOwn(user, "tracker_updates")) {
    return isOwner;
  }
  if (hasPermission(user, "projects", action) || hasPermission(user, "tracker_projects", action)) return true;
  if (action === "view" && hasPermission(user, "tracker_updates", "view")) return true;
  return isOwner;
}

export function extractNotesPreview(notes?: string | null): string | null {
  if (!notes) return null;
  const plainText = stripHtmlToText(notes).replace(/\s+/g, ' ').trim();
  if (!plainText) return null;
  return plainText.length > 300 ? plainText.slice(0, 300) : plainText;
}

const projectListSelect = {
  id: true,
  name: true,
  clientId: true,
  clientName: true,
  responsible: true,
  responsibleId: true,
  type: true,
  start: true,
  deadline: true,
  progress: true,
  done: true,
  notesPreview: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: { id: true, name: true, city: true },
  },
  reminders: {
    select: { id: true, title: true, dueDate: true, status: true },
  },
  invoices: {
    select: { id: true, invoiceNumber: true, status: true, totalAmount: true, dueDate: true },
  },
};

// ----------------------------------------------------
// PROJECTS CRUD
// ----------------------------------------------------

// GET /api/projects
router.get('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const isOnlyOwn = isRestrictedToOwn(authUser, "projects");
  const search = ((req.query.search as string) || '').trim();

  let ownerCondition: any = undefined;
  if (isOnlyOwn) {
    ownerCondition = {
      OR: [
        { responsibleId: authUser.id },
        ...(authUser.name ? [{ responsible: { equals: authUser.name, mode: 'insensitive' as const } }] : []),
      ],
    };
  }

  const searchCondition = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { clientName: { contains: search, mode: 'insensitive' as const } },
      { responsible: { contains: search, mode: 'insensitive' as const } },
    ]
  } : undefined;

  const doneParam = req.query.done;
  const doneCondition = (doneParam === 'true' || doneParam === 'false')
    ? { done: doneParam === 'true' }
    : undefined;

  const sinceDate = parseSince(req.query.since);
  const deltaCondition = sinceDate ? { updatedAt: { gt: sinceDate } } : undefined;

  const conditions: any[] = [];
  if (ownerCondition) conditions.push(ownerCondition);
  if (searchCondition) conditions.push(searchCondition);
  if (doneCondition) conditions.push(doneCondition);
  if (deltaCondition) conditions.push(deltaCondition);

  // Status filter (active, done, overdue, stale, creation, missing_invoice)
  const status = ((req.query.status as string) || '').trim();
  if (status && status !== 'all') {
    const today = new Date().toISOString().slice(0, 10);
    const twoMonthsAgoDate = new Date();
    twoMonthsAgoDate.setMonth(twoMonthsAgoDate.getMonth() - 2);
    const twoMonthsAgo = twoMonthsAgoDate.toISOString().slice(0, 10);

    if (status === 'done') {
      conditions.push({ done: true });
    } else if (status === 'active') {
      conditions.push({ done: false });
    } else if (status === 'overdue' || status === 'late') {
      conditions.push({
        done: false,
        deadline: { lt: today, not: null },
      });
    } else if (status === 'stale') {
      conditions.push({
        done: false,
        start: { lt: twoMonthsAgo, not: null },
      });
    } else if (status === 'creation') {
      conditions.push({
        done: false,
        progress: 0,
      });
    } else if (status === 'missing_invoice') {
      conditions.push({
        done: false,
        invoices: { none: {} },
      });
    }
  }

  // Type (category) filter
  const type = ((req.query.type as string) || '').trim();
  if (type && type !== 'all') {
    conditions.push({ type });
  }

  // ClientId filter
  const clientId = ((req.query.clientId as string) || '').trim();
  if (clientId && clientId !== 'all') {
    conditions.push({ clientId });
  }

  // Responsible filter
  const responsible = ((req.query.responsible as string) || '').trim();
  if (responsible && responsible !== 'all') {
    conditions.push({
      OR: [
        { responsibleId: responsible },
        { responsible: { equals: responsible, mode: 'insensitive' as const } },
      ],
    });
  }

  // Date range filter
  const dateFrom = ((req.query.dateFrom as string) || '').trim();
  const dateTo = ((req.query.dateTo as string) || '').trim();
  const dateField = (req.query.dateField as string) || 'deadline';
  const allowedDateFields = ['deadline', 'start', 'createdAt'];
  const targetDateField = allowedDateFields.includes(dateField) ? dateField : 'deadline';
  if (dateFrom || dateTo) {
    const dateCondition: any = {};
    if (dateFrom) dateCondition.gte = targetDateField === 'createdAt' ? new Date(dateFrom) : dateFrom;
    if (dateTo) dateCondition.lte = targetDateField === 'createdAt' ? new Date(dateTo) : dateTo;
    conditions.push({ [targetDateField]: dateCondition });
  }

  const where: any = conditions.length > 1
    ? { AND: conditions }
    : (conditions[0] || {});

  // Sorting
  const sortBy = ((req.query.sortBy as string) || 'deadline').trim();
  const sortOrder = ((req.query.sortOrder as string) || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  let orderBy: any;
  if (sortBy === 'name') {
    orderBy = { name: sortOrder };
  } else if (sortBy === 'clientName') {
    orderBy = { clientName: sortOrder };
  } else if (sortBy === 'responsible') {
    orderBy = { responsible: sortOrder };
  } else if (sortBy === 'progress') {
    orderBy = { progress: sortOrder };
  } else if (sortBy === 'start') {
    orderBy = { start: sortOrder };
  } else if (sortBy === 'createdAt') {
    orderBy = { createdAt: sortOrder };
  } else {
    // default deadline
    orderBy = { deadline: sortOrder };
  }

  const pagination = parsePagination(req.query, 25);

  if (pagination.isPaginated) {
    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        select: projectListSelect,
      }),
    ]);
    res.json(buildPaginatedResponse(projects, total, pagination.page, pagination.limit));
    return;
  }

  const [projects, deletedIds] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy,
      select: projectListSelect,
    }),
    sinceDate ? fetchDeletedIds('Project', sinceDate) : Promise.resolve([]),
  ]);

  res.json(buildDeltaResponse(projects, deletedIds, sinceDate));
}));

// GET /api/projects/updates
router.get('/updates', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;

  if (!hasPermission(authUser, 'tracker_updates', 'view')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  // Default range: yesterday 00:00:00 to now
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const fromDate = req.query.dateFrom ? new Date(req.query.dateFrom as string) : yesterday;
  let toDate = req.query.dateTo ? new Date(req.query.dateTo as string) : now;
  if (typeof req.query.dateTo === 'string' && req.query.dateTo.length === 10) {
    toDate.setHours(23, 59, 59, 999);
  }

  const responsibleId = req.query.responsibleId as string | undefined;
  const search = ((req.query.search as string) || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

  // 1. Gather all activity within date range across:
  // a) ProjectNoteVersion
  // b) EntityVersion for Project
  // c) Reminders updated/created with projectId
  // d) Invoices updated/created with projectId
  const [noteVersions, projectEntityVersions, remindersInRange, invoicesInRange] = await Promise.all([
    basePrisma.projectNoteVersion.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      select: {
        note: { select: { projectId: true } },
        charDelta: true,
        authorName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    basePrisma.entityVersion.findMany({
      where: {
        entityType: 'Project',
        createdAt: { gte: fromDate, lte: toDate },
      },
      include: {
        changeSet: { select: { userName: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.reminder.findMany({
      where: {
        projectId: { not: null },
        OR: [
          { createdAt: { gte: fromDate, lte: toDate } },
          { updatedAt: { gte: fromDate, lte: toDate } },
        ],
      },
      select: { id: true, projectId: true, createdAt: true, updatedAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        projectId: { not: null },
        OR: [
          { createdAt: { gte: fromDate, lte: toDate } },
          { updatedAt: { gte: fromDate, lte: toDate } },
        ],
      },
      select: { id: true, projectId: true, createdAt: true, updatedAt: true },
    }),
  ]);

  interface AggregatedUpdate {
    lastModifiedAt: Date;
    lastModifiedBy?: string;
    revisionCount: number;
    changedFields: Set<string>;
    noteCharDelta: number;
    addedRemindersCount: number;
    updatedRemindersCount: number;
    addedInvoicesCount: number;
    updatedInvoicesCount: number;
  }

  const updatesMap = new Map<string, AggregatedUpdate>();

  const getOrCreate = (pid: string, defaultDate: Date): AggregatedUpdate => {
    let agg = updatesMap.get(pid);
    if (!agg) {
      agg = {
        lastModifiedAt: defaultDate,
        revisionCount: 0,
        changedFields: new Set<string>(),
        noteCharDelta: 0,
        addedRemindersCount: 0,
        updatedRemindersCount: 0,
        addedInvoicesCount: 0,
        updatedInvoicesCount: 0,
      };
      updatesMap.set(pid, agg);
    }
    return agg;
  };

  // Process note versions
  for (const nv of noteVersions) {
    const pid = nv.note?.projectId;
    if (!pid) continue;
    const agg = getOrCreate(pid, nv.createdAt);
    if (nv.createdAt > agg.lastModifiedAt) {
      agg.lastModifiedAt = nv.createdAt;
      if (nv.authorName) agg.lastModifiedBy = nv.authorName;
    } else if (!agg.lastModifiedBy && nv.authorName) {
      agg.lastModifiedBy = nv.authorName;
    }
    agg.revisionCount += 1;
    agg.changedFields.add('notes');
    agg.noteCharDelta += nv.charDelta || 0;
  }

  // Process project entity versions
  for (const ev of projectEntityVersions) {
    const pid = ev.entityId;
    const meaningfulFields = Array.isArray(ev.changedFields)
      ? ev.changedFields.filter(
          (f) =>
            typeof f === 'string' &&
            f !== 'updatedAt' &&
            f !== 'id' &&
            f !== 'createdAt' &&
            f !== 'notesPreview'
        )
      : [];

    if (meaningfulFields.length === 0) continue;

    const agg = getOrCreate(pid, ev.createdAt);
    if (ev.createdAt > agg.lastModifiedAt) {
      agg.lastModifiedAt = ev.createdAt;
      if (ev.changeSet?.userName) agg.lastModifiedBy = ev.changeSet.userName;
    } else if (!agg.lastModifiedBy && ev.changeSet?.userName) {
      agg.lastModifiedBy = ev.changeSet.userName;
    }
    agg.revisionCount += 1;
    for (const f of meaningfulFields) {
      agg.changedFields.add(f);
    }
  }

  // Process reminders
  for (const rem of remindersInRange) {
    if (!rem.projectId) continue;
    const remDate = rem.updatedAt || rem.createdAt;
    const agg = getOrCreate(rem.projectId, remDate);
    if (remDate > agg.lastModifiedAt) {
      agg.lastModifiedAt = remDate;
    }
    if (rem.createdAt >= fromDate && rem.createdAt <= toDate) {
      agg.addedRemindersCount += 1;
      agg.changedFields.add('reminders');
    } else {
      agg.updatedRemindersCount += 1;
      agg.changedFields.add('reminders');
    }
  }

  // Process invoices
  for (const inv of invoicesInRange) {
    if (!inv.projectId) continue;
    const invDate = inv.updatedAt || inv.createdAt;
    const agg = getOrCreate(inv.projectId, invDate);
    if (invDate > agg.lastModifiedAt) {
      agg.lastModifiedAt = invDate;
    }
    if (inv.createdAt >= fromDate && inv.createdAt <= toDate) {
      agg.addedInvoicesCount += 1;
      agg.changedFields.add('invoices');
    } else {
      agg.updatedInvoicesCount += 1;
      agg.changedFields.add('invoices');
    }
  }

  // Only consider projects with actual visible changes
  const allUpdatedProjectIds = Array.from(updatesMap.entries())
    .filter(([_, agg]) =>
      agg.changedFields.size > 0 ||
      agg.addedRemindersCount > 0 ||
      agg.updatedRemindersCount > 0 ||
      agg.addedInvoicesCount > 0 ||
      agg.updatedInvoicesCount > 0
    )
    .map(([pid]) => pid);

  if (allUpdatedProjectIds.length === 0) {
    res.json({
      total: 0,
      dateFrom: fromDate.toISOString(),
      dateTo: toDate.toISOString(),
      limit,
      offset,
      updates: [],
    });
    return;
  }

  // 2. Query Project records with ownership & search filtering
  const where: any = {
    id: { in: allUpdatedProjectIds },
  };

  if (responsibleId) {
    where.responsibleId = responsibleId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { clientName: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (isRestrictedToOwn(authUser, "tracker_updates") || isRestrictedToOwn(authUser, "tracker_projects") || isRestrictedToOwn(authUser, "projects")) {
    const ownerConditions = [
      { responsible: authUser.name },
      { responsibleId: authUser.id },
    ];
    if (where.OR) {
      where.AND = [
        { OR: where.OR },
        { OR: ownerConditions },
      ];
      delete where.OR;
    } else {
      where.OR = ownerConditions;
    }
  }

  const matchedProjects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      clientId: true,
      clientName: true,
      responsible: true,
      responsibleId: true,
      type: true,
      start: true,
      deadline: true,
      progress: true,
      done: true,
      notesPreview: true,
      updatedAt: true,
      client: {
        select: { id: true, name: true, city: true },
      },
    },
  });

  const enriched = matchedProjects.map((proj) => {
    const agg = updatesMap.get(proj.id)!;
    return {
      id: proj.id,
      name: proj.name,
      clientId: proj.clientId,
      clientName: proj.clientName,
      responsible: proj.responsible,
      responsibleId: proj.responsibleId,
      type: proj.type,
      start: proj.start,
      deadline: proj.deadline,
      progress: proj.progress,
      done: proj.done,
      notesPreview: proj.notesPreview,
      client: proj.client,
      lastModifiedAt: agg.lastModifiedAt.toISOString(),
      lastModifiedBy: agg.lastModifiedBy || proj.responsible || 'Sistem',
      revisionCount: agg.revisionCount || 1,
      changedFields: Array.from(agg.changedFields),
      noteCharDelta: agg.noteCharDelta,
      addedRemindersCount: agg.addedRemindersCount,
      updatedRemindersCount: agg.updatedRemindersCount,
      addedInvoicesCount: agg.addedInvoicesCount,
      updatedInvoicesCount: agg.updatedInvoicesCount,
    };
  });

  enriched.sort((a, b) => new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime());

  const total = enriched.length;
  const paginated = enriched.slice(offset, offset + limit);

  res.json({
    total,
    dateFrom: fromDate.toISOString(),
    dateTo: toDate.toISOString(),
    limit,
    offset,
    updates: paginated,
  });
}));

// GET /api/projects/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: {
        select: { id: true, name: true, city: true },
      },
      note: {
        select: { content: true, version: true, updatedAt: true },
      },
    },
  });

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Backward compatibility: provide `notes` from note relation
  res.json({
    ...project,
    notes: project.note?.content || null,
  });
}));

// POST /api/projects
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const { name, clientId, clientName, responsible, type, start, deadline, progress, done, notes } = req.body;

  if (!name || (!clientId && !clientName) || !type) {
    res.status(400).json({ error: 'Name, client, and type are required' });
    return;
  }

  let finalClientName = clientName || '';
  if (clientId) {
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    if (c) finalClientName = c.name;
  }

  const isOnlyOwn = isRestrictedToOwn(authUser, "projects");
  let finalResponsible = authUser.name || "";
  let finalResponsibleId: string | null = authUser.id;

  if (!isOnlyOwn) {
    finalResponsible = (responsible ? String(responsible).trim() : "") || authUser.name;
    if (responsible) {
      const matchedUser = await prisma.user.findFirst({ where: { name: responsible } });
      if (matchedUser) finalResponsibleId = matchedUser.id;
    }
  }

  const progVal = Math.max(0, Math.min(100, Number(progress) || 0));
  const isDone = done !== undefined ? Boolean(done) : progVal >= 100;

  const project = await prisma.project.create({
    data: {
      name,
      clientId: clientId || null,
      clientName: finalClientName,
      responsible: finalResponsible,
      responsibleId: finalResponsibleId,
      type,
      start: start || null,
      deadline: deadline || null,
      progress: progVal,
      done: isDone,
      notesPreview: extractNotesPreview(notes),
    },
  });

  if (notes) {
    await saveNoteRevision({
      projectId: project.id,
      newContent: notes,
      authorId: authUser.id,
      authorName: authUser.name,
      reason: 'Initial Note Creation',
    });
  }

  res.status(201).json({
    ...project,
    notes: notes || null,
  });
}));

// PUT /api/projects/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const { name, clientId, clientName, responsible, type, start, deadline, progress, done, notes } = req.body;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, existing, "edit")) {
    res.status(403).json({ error: 'Permission denied. You can only edit projects you own or have permission to edit.' });
    return;
  }

  let finalClientName = clientName || existing.clientName;
  if (clientId) {
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    if (c) finalClientName = c.name;
  }

  const isOnlyOwn = isRestrictedToOwn(authUser, "projects");
  let finalResponsible = responsible !== undefined ? (responsible ? String(responsible).trim() : "") : existing.responsible;
  let finalResponsibleId = existing.responsibleId;

  if (isOnlyOwn) {
    finalResponsible = authUser.name || existing.responsible;
    finalResponsibleId = authUser.id;
  } else if (responsible) {
    const matchedUser = await prisma.user.findFirst({ where: { name: responsible } });
    if (matchedUser) finalResponsibleId = matchedUser.id;
  }

  const progVal = progress !== undefined ? Math.max(0, Math.min(100, Number(progress) || 0)) : existing.progress;
  const isDone = done !== undefined ? Boolean(done) : (progVal >= 100 ? true : existing.done);

  const updated = await prisma.project.update({
    where: { id },
    data: {
      name: name !== undefined ? name : existing.name,
      clientId: clientId !== undefined ? (clientId || null) : existing.clientId,
      clientName: finalClientName,
      responsible: finalResponsible,
      responsibleId: finalResponsibleId,
      type: type !== undefined ? type : existing.type,
      start: start !== undefined ? (start || null) : existing.start,
      deadline: deadline !== undefined ? (deadline || null) : existing.deadline,
      progress: progVal,
      done: isDone,
      notesPreview: notes !== undefined ? extractNotesPreview(notes) : existing.notesPreview,
    },
  });

  let currentNoteContent: string | null = null;
  if (notes !== undefined) {
    const noteRes = await saveNoteRevision({
      projectId: updated.id,
      newContent: notes || '',
      authorId: authUser.id,
      authorName: authUser.name,
      skipActivityLog: true,
    });
    currentNoteContent = noteRes.content;
  }

  res.json({
    ...updated,
    notes: currentNoteContent,
  });
}));

// PATCH /api/projects/:id/toggle-done
router.patch('/:id/toggle-done', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, existing, "edit")) {
    res.status(403).json({ error: 'Permission denied. You can only edit projects you own or have permission to edit.' });
    return;
  }

  const newDone = !existing.done;
  const newProgress = newDone ? 100 : existing.progress;

  const updated = await prisma.project.update({
    where: { id },
    data: { done: newDone, progress: newProgress },
  });

  res.json(updated);
}));

// PATCH /api/projects/:id/notes (Backward compatibility alias)
router.patch('/:id/notes', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const { notes } = req.body;

  const existing = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, responsible: true, responsibleId: true },
  });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, existing, "edit")) {
    res.status(403).json({ error: 'Permission denied. You can only edit projects you own or have permission to edit.' });
    return;
  }

  const result = await saveNoteRevision({
    projectId: id,
    newContent: notes || '',
    authorId: authUser.id,
    authorName: authUser.name,
  });

  res.json({
    id: existing.id,
    notes: result.content,
    notesPreview: result.notesPreview,
    version: result.version,
    updatedAt: new Date().toISOString(),
  });
}));

// GET /api/projects/:id/note
router.get('/:id/note', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsible: true, responsibleId: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "view")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const note = await prisma.projectNote.findUnique({
    where: { projectId: id },
  });

  if (!note) {
    res.json({
      id: null,
      projectId: id,
      content: '',
      version: 0,
      updatedAt: null,
    });
    return;
  }

  res.json(note);
}));

// PATCH /api/projects/:id/note
router.patch('/:id/note', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const { content, reason } = req.body;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsible: true, responsibleId: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "edit")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const result = await saveNoteRevision({
    projectId: id,
    newContent: typeof content === 'string' ? content : '',
    authorId: authUser.id,
    authorName: authUser.name,
    reason,
  });

  res.json({
    id: result.id,
    projectId: id,
    content: result.content,
    version: result.version,
    notesPreview: result.notesPreview,
    updatedAt: new Date().toISOString(),
  });
}));

// GET /api/projects/:id/note/history
router.get('/:id/note/history', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsible: true, responsibleId: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "view")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const note = await prisma.projectNote.findUnique({
    where: { projectId: id },
    select: { id: true },
  });

  if (!note) {
    res.json({ total: 0, versions: [] });
    return;
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  const history = await getNoteRevisionsList(note.id, limit, offset);
  res.json(history);
}));

// GET /api/projects/:id/note/diff
router.get('/:id/note/diff', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsible: true, responsibleId: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "view")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const note = await prisma.projectNote.findUnique({
    where: { projectId: id },
    select: { id: true },
  });

  if (!note) {
    res.status(404).json({ error: 'Project note not found' });
    return;
  }

  const vFromStr = typeof req.query.vFrom === 'string' ? req.query.vFrom : undefined;
  const vToStr = typeof req.query.vTo === 'string' ? req.query.vTo : undefined;
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

  let resolvedFrom: number;
  let resolvedTo: number;

  if (dateFrom || dateTo) {
    const resolved = await resolveNoteVersionsByDate(
      note.id,
      dateFrom,
      dateTo
    );
    resolvedFrom = resolved.from;
    resolvedTo = resolved.to;
  } else {
    resolvedFrom = parseInt(vFromStr || '', 10);
    resolvedTo = parseInt(vToStr || '', 10);

    if (isNaN(resolvedFrom) || isNaN(resolvedTo)) {
      res.status(400).json({ error: 'Either vFrom/vTo integers or dateFrom/dateTo strings must be provided' });
      return;
    }
  }

  const diffResult = await diffNoteVersions(note.id, resolvedFrom, resolvedTo);
  res.json({
    ...diffResult,
    dateFrom,
    dateTo,
  });
}));

// GET /api/projects/:id/updates-diff
router.get('/:id/updates-diff', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
    },
  });

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "view")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const dateFromStr = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateToStr = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const parsedFrom = dateFromStr ? new Date(dateFromStr) : null;
  const fromDate = parsedFrom && !isNaN(parsedFrom.getTime()) ? parsedFrom : yesterday;

  const parsedTo = dateToStr ? new Date(dateToStr) : null;
  let toDate = parsedTo && !isNaN(parsedTo.getTime()) ? parsedTo : now;
  if (dateToStr && dateToStr.length === 10) {
    toDate.setHours(23, 59, 59, 999);
  }

  // 1. Field diffs from versioning service
  let fieldDiffs: Record<string, { old: any; new: any }> = {};
  try {
    const resolved = await resolveVersionsByDate(
      'Project',
      id,
      fromDate.toISOString(),
      toDate.toISOString()
    );
    if (resolved.from !== resolved.to) {
      const diffResult = await diffVersions('Project', id, resolved.from, resolved.to);
      fieldDiffs = diffResult.diff;
    }
  } catch {
    // If no entity versions exist, fieldDiffs remains empty
  }

  // 2. Rich text note diff
  let notesDiffResult: any = null;
  const note = await prisma.projectNote.findUnique({
    where: { projectId: id },
    select: { id: true, content: true },
  });

  if (note) {
    try {
      const resolvedNote = await resolveNoteVersionsByDate(
        note.id,
        fromDate.toISOString(),
        toDate.toISOString()
      );
      if (resolvedNote.from !== resolvedNote.to) {
        notesDiffResult = await diffNoteVersions(note.id, resolvedNote.from, resolvedNote.to);
      } else {
        const plainNote = stripHtmlToText(note.content || '');
        notesDiffResult = {
          vFrom: resolvedNote.from,
          vTo: resolvedNote.to,
          diff: [],
          oldContent: plainNote,
          newContent: plainNote,
        };
      }
    } catch {
      notesDiffResult = null;
    }
  }

  // 3. Reminders created or modified in range
  const reminders = await prisma.reminder.findMany({
    where: {
      projectId: id,
      OR: [
        { createdAt: { gte: fromDate, lte: toDate } },
        { updatedAt: { gte: fromDate, lte: toDate } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const remindersResult = reminders.map((r) => ({
    id: r.id,
    title: r.title,
    dueDate: r.dueDate,
    status: r.status,
    isNew: r.createdAt >= fromDate && r.createdAt <= toDate,
  }));

  // 4. Invoices created or modified in range
  const invoices = await prisma.invoice.findMany({
    where: {
      projectId: id,
      OR: [
        { createdAt: { gte: fromDate, lte: toDate } },
        { updatedAt: { gte: fromDate, lte: toDate } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      totalAmount: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const invoicesResult = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    total: inv.totalAmount,
    currency: inv.currency,
    isNew: inv.createdAt >= fromDate && inv.createdAt <= toDate,
  }));

  res.json({
    projectId: id,
    projectName: project.name,
    dateFrom: fromDate.toISOString(),
    dateTo: toDate.toISOString(),
    fieldDiffs,
    notesDiff: notesDiffResult,
    reminders: remindersResult,
    invoices: invoicesResult,
  });
}));

// POST /api/projects/:id/note/restore/:v
router.post('/:id/note/restore/:v', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const targetVersion = parseInt(req.params.v as string, 10);

  if (isNaN(targetVersion) || targetVersion < 1) {
    res.status(400).json({ error: 'Invalid version number' });
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsible: true, responsibleId: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, project, "edit")) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const result = await restoreNoteVersion(id, targetVersion, {
    id: authUser.id,
    name: authUser.name,
  });

  res.json(result);
}));

// DELETE /api/projects/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, existing, "delete")) {
    res.status(403).json({ error: 'Permission denied. You can only delete projects you own or have permission to delete.' });
    return;
  }

  await prisma.project.delete({ where: { id } });
  res.json({ message: 'Project deleted successfully' });
}));

export default router;
