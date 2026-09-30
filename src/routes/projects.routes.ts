import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission, isRestrictedToOwn } from '../types';
import { addMonths } from '../helpers/dateUtils';
import { handleProjectNotesMentions } from '../helpers/mentionHelper';

const router = Router();

// Require authentication for all projects routes
router.use(requireAuth);

// Helper to check if a user is the owner of a project or an admin/manager
function isProjectOwnerOrCan(
  user: any,
  project: { responsible?: string | null; responsibleId?: string | null },
  action: "edit" | "delete"
): boolean {
  if (user.role === "Administrator" || user.roleEntity?.isSystemAdmin || user.realRole === "Administrator" || user.realRoleEntity?.isSystemAdmin) return true;
  const isOwner = Boolean(
    (project.responsible && project.responsible.trim().toLowerCase() === (user.name || "").trim().toLowerCase()) ||
    (project.responsibleId && project.responsibleId === user.id)
  );
  if (isRestrictedToOwn(user, "projects")) {
    return isOwner;
  }
  if (hasPermission(user, "projects", action) || hasPermission(user, "tracker_projects", action)) return true;
  return isOwner;
}

// ----------------------------------------------------
// PROJECTS CRUD
// ----------------------------------------------------

// GET /api/projects
router.get('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const isSimulating = Boolean((authUser as any).isSimulatingRole);
  const isOnlyOwn = isRestrictedToOwn(authUser, "projects");
  const search = ((req.query.search as string) || '').trim();

  let ownerCondition: any = undefined;
  if (isOnlyOwn) {
    if (isSimulating) {
      const roleUsers = await prisma.user.findMany({
        where: { role: authUser.role },
        select: { id: true, name: true },
      });
      const userIds = roleUsers.map((u) => u.id);
      const userNames = roleUsers.map((u) => u.name).filter(Boolean);
      ownerCondition = {
        OR: [
          { responsibleId: { in: userIds } },
          ...(userNames.length > 0 ? [{ responsible: { in: userNames, mode: 'insensitive' as const } }] : []),
        ],
      };
    } else {
      ownerCondition = {
        OR: [
          { responsibleId: authUser.id },
          ...(authUser.name ? [{ responsible: { equals: authUser.name, mode: 'insensitive' as const } }] : []),
        ],
      };
    }
  }

  const searchCondition = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { clientName: { contains: search, mode: 'insensitive' as const } },
      { responsible: { contains: search, mode: 'insensitive' as const } },
    ]
  } : undefined;

  let where: any = {};
  if (ownerCondition && searchCondition) {
    where = { AND: [ownerCondition, searchCondition] };
  } else if (ownerCondition) {
    where = ownerCondition;
  } else if (searchCondition) {
    where = searchCondition;
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { client: true },
  });

  res.json(projects);
}));

// POST /api/projects
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const { name, clientId, clientName, responsible, type, start, deadline, progress, done, nextSample, notes } = req.body;

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

  const computedNextSample = nextSample || null;

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
      nextSample: computedNextSample,
      notes: notes || null,
    },
  });

  if (project.notes) {
    await handleProjectNotesMentions(project.id, project.name, project.notes, null, authUser);
  }

  res.status(201).json(project);
}));

// PUT /api/projects/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const { name, clientId, clientName, responsible, type, start, deadline, progress, done, nextSample, notes } = req.body;

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

  const computedNextSample = nextSample || null;

  const progVal = Math.max(0, Math.min(100, Number(progress) || 0));
  const isDone = done !== undefined ? Boolean(done) : (progVal >= 100 ? true : existing.done);

  const updated = await prisma.project.update({
    where: { id },
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
      nextSample: computedNextSample,
      notes: notes !== undefined ? (notes || null) : existing.notes,
    },
  });

  if (updated.notes) {
    await handleProjectNotesMentions(updated.id, updated.name, updated.notes, existing.notes, authUser);
  }

  res.json(updated);
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

// PATCH /api/projects/:id/sample
router.patch('/:id/sample', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || !existing.nextSample) {
    res.status(400).json({ error: 'Project has no next sample date' });
    return;
  }

  if (!isProjectOwnerOrCan(authUser, existing, "edit")) {
    res.status(403).json({ error: 'Permission denied. You can only edit projects you own or have permission to edit.' });
    return;
  }

  const service = await prisma.service.findUnique({ where: { code: existing.type } });
  const freq = service?.frequency || 3;
  const newNextSample = addMonths(existing.nextSample, freq);

  const updated = await prisma.project.update({
    where: { id },
    data: { nextSample: newNextSample },
  });

  res.json(updated);
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
