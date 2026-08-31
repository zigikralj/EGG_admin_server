import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { Project } from '@prisma/client';
import { UserRole } from '../types';
import { addMonths } from '../helpers/dateUtils';
import { handleProjectNotesMentions } from '../helpers/mentionHelper';

const router = Router();

// Require authentication for all projects routes
router.use(requireAuth);

// Helper to check if a role is Admin or Manager
function isAdminOrManager(role: string): boolean {
  return role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER;
}

// Helper to check if a user is the owner of a project or an admin/manager
function isProjectOwnerOrAdminManager(
  user: { id: string; name: string; role: string },
  project: { responsible: string | null; responsibleId: string | null }
): boolean {
  if (isAdminOrManager(user.role)) return true;
  if (project.responsible && project.responsible.trim().toLowerCase() === user.name.trim().toLowerCase()) return true;
  if (project.responsibleId && project.responsibleId === user.id) return true;
  return false;
}

// ----------------------------------------------------
// PROJECTS CRUD
// ----------------------------------------------------

// GET /api/projects
router.get('/', asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const where = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { clientName: { contains: search, mode: 'insensitive' as const } },
      { responsible: { contains: search, mode: 'insensitive' as const } },
    ]
  } : {};

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

  // Standard Users must assign themselves as responsible
  let finalResponsible = responsible || authUser.name;
  let finalResponsibleId: string | null = authUser.id;

  if (authUser.role === UserRole.USER) {
    finalResponsible = authUser.name;
    finalResponsibleId = authUser.id;
  } else if (responsible) {
    // Find matching user ID if possible
    const matchedUser = await prisma.user.findFirst({ where: { name: responsible } });
    if (matchedUser) finalResponsibleId = matchedUser.id;
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

  if (!isProjectOwnerOrAdminManager(authUser, existing)) {
    res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
    return;
  }

  let finalClientName = clientName || existing.clientName;
  if (clientId) {
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    if (c) finalClientName = c.name;
  }

  let finalResponsible = responsible || existing.responsible;
  let finalResponsibleId = existing.responsibleId;

  if (authUser.role === UserRole.USER) {
    finalResponsible = authUser.name;
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

  if (!isProjectOwnerOrAdminManager(authUser, existing)) {
    res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
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

  if (!isProjectOwnerOrAdminManager(authUser, existing)) {
    res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
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

  if (!isProjectOwnerOrAdminManager(authUser, existing)) {
    res.status(403).json({ error: 'Permission denied. Standard Users can only delete their own projects.' });
    return;
  }

  await prisma.project.delete({ where: { id } });
  res.json({ message: 'Project deleted successfully' });
}));

// ----------------------------------------------------
// REMINDERS CRUD
// ----------------------------------------------------

// GET /api/projects/reminders (using /projects prefix because it's mounted as /api/projects in index.ts)
// Wait, in index.ts, reminders are mounted on /api/reminders. I will export a separate router for them,
// or I can mount them in index.ts on their own. Let's make a separate router for reminders to keep things cleaner.
// I will create reminders.routes.ts instead of cluttering this one.
export default router;
