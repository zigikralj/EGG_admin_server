import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../db';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {

  const roles = await prisma.role.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { users: true } }
    }
  });

  res.json(roles);
}));

router.post('/', asyncHandler(async (req, res) => {
  const authUser = (req as any).authUser;
  const userRole = authUser?.roleEntity;
  const isSysAdmin = authUser?.role === 'Administrator' || Boolean(userRole?.isSystemAdmin);
  
  if (!isSysAdmin && !userRole?.permissions?.roles?.includes('create')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const { name, description, isSystemAdmin, permissions } = req.body;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Role name is required.' });
    return;
  }

  if (isSystemAdmin) {
    if (!isSysAdmin) {
      res.status(403).json({ error: 'Only system admins can create system admin roles.' });
      return;
    }
    const existingSysAdmin = await prisma.role.findFirst({ where: { isSystemAdmin: true } });
    if (existingSysAdmin) {
      res.status(400).json({ error: 'Only one role can be designated as System Administrator.' });
      return;
    }
  }

  const existing = await prisma.role.findUnique({ where: { name } });
  if (existing) {
    res.status(400).json({ error: 'Role with this name already exists.' });
    return;
  }

  const role = await prisma.role.create({
    data: {
      name,
      description,
      isSystemAdmin: !!isSystemAdmin,
      permissions: permissions || {},
    },
  });

  res.status(201).json(role);
}));

router.put('/:name', asyncHandler(async (req, res) => {
  const authUser = (req as any).authUser;
  const userRole = authUser?.roleEntity;
  const isSysAdmin = authUser?.role === 'Administrator' || Boolean(userRole?.isSystemAdmin);
  
  if (!isSysAdmin && !userRole?.permissions?.roles?.includes('edit')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const name = req.params.name as string;
  const { description, isSystemAdmin, permissions } = req.body;

  const roleToUpdate = await prisma.role.findUnique({ where: { name } });
  if (!roleToUpdate) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }

  if (name === 'Administrator' && isSystemAdmin === false) {
    res.status(400).json({ error: 'Cannot remove system admin privileges from the default Administrator role.' });
    return;
  }

  if (isSystemAdmin && !roleToUpdate.isSystemAdmin) {
    if (!isSysAdmin) {
      res.status(403).json({ error: 'Only system admins can grant system admin privileges.' });
      return;
    }
    const existingSysAdmin = await prisma.role.findFirst({ where: { isSystemAdmin: true } });
    if (existingSysAdmin) {
      res.status(400).json({ error: 'Only one role can be designated as System Administrator.' });
      return;
    }
  }

  const updatedRole = await prisma.role.update({
    where: { name },
    data: {
      description: description !== undefined ? description : roleToUpdate.description,
      isSystemAdmin: isSystemAdmin !== undefined ? Boolean(isSystemAdmin) : roleToUpdate.isSystemAdmin,
      permissions: permissions !== undefined ? permissions : roleToUpdate.permissions,
    },
  });

  res.json(updatedRole);
}));

router.delete('/:name', asyncHandler(async (req, res) => {
  const authUser = (req as any).authUser;
  const userRole = authUser?.roleEntity;
  const isSysAdmin = authUser?.role === 'Administrator' || Boolean(userRole?.isSystemAdmin);
  
  if (!isSysAdmin && !userRole?.permissions?.roles?.includes('delete')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const name = req.params.name as string;

  if (name === 'Administrator') {
    res.status(400).json({ error: 'Cannot delete the default Administrator role.' });
    return;
  }

  const roleToDelete = await prisma.role.findUnique({ 
    where: { name },
    include: { _count: { select: { users: true } } }
  });

  if (!roleToDelete) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }

  if (roleToDelete._count?.users > 0) {
    res.status(400).json({ error: 'Cannot delete role because it is assigned to users.' });
    return;
  }

  await prisma.role.delete({ where: { name } });

  res.json({ success: true });
}));

export default router;
