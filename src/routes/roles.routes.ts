import { Router } from 'express';
import { requireAuth, invalidateUserAuthCache } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../db';
import { hasPermission, isRestrictedToOwn, isUserSystemAdmin, UserRole } from '../types';
import { invalidateReferenceCache } from '../helpers/referenceCache';
import { getRolesFromDb, isRoleLessThan, ROLES_CACHE_KEY } from '../helpers/roleLevels';
import { sanitizeRolePermissions, findUnauthorizedGrants } from '../constants/permissionCatalog';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const roles = await getRolesFromDb();
  if (!isUserSystemAdmin(req.authUser) && !hasPermission(req.authUser, 'roles', 'view')) {
    res.json(roles.map(({ permissions: _permissions, ...rest }) => rest));
    return;
  }
  res.json(roles);
}));

router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser;
  const isSysAdmin = isUserSystemAdmin(authUser);

  if (!hasPermission(authUser, 'roles', 'create')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const { name, description, level, isSystemAdmin, permissions } = req.body;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Role name is required.' });
    return;
  }

  const sanitized = sanitizeRolePermissions(permissions);
  if (!sanitized.ok) {
    res.status(400).json({ error: sanitized.error });
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

  const parsedLevel =
    level !== undefined && !Number.isNaN(Number(level))
      ? Math.max(1, Math.min(100, Math.round(Number(level))))
      : 10;

  if (!isSysAdmin) {
    if (!(await isRoleLessThan(parsedLevel, authUser))) {
      res.status(403).json({ error: 'Cannot create a role with level equal to or above your own.' });
      return;
    }
    const violations = findUnauthorizedGrants(authUser, sanitized.permissions, hasPermission, isRestrictedToOwn);
    if (violations.length > 0) {
      res.status(403).json({ error: 'Cannot grant permissions you do not possess.', violations });
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
      ...(level !== undefined && !Number.isNaN(Number(level)) ? { level: parsedLevel } : {}),
      isSystemAdmin: !!isSystemAdmin,
      permissions: sanitized.permissions,
    },
  });

  invalidateUserAuthCache();
  invalidateReferenceCache(ROLES_CACHE_KEY);
  res.status(201).json(role);
}));

router.put('/:name', asyncHandler(async (req, res) => {
  const authUser = req.authUser;
  const isSysAdmin = isUserSystemAdmin(authUser);

  if (!hasPermission(authUser, 'roles', 'edit')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const name = req.params.name as string;
  const { description, level, isSystemAdmin, permissions } = req.body;

  const roleToUpdate = await prisma.role.findUnique({ where: { name } });
  if (!roleToUpdate) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }

  if (name === UserRole.ADMINISTRATOR && isSystemAdmin === false) {
    res.status(400).json({ error: 'Cannot remove system admin privileges from the default Administrator role.' });
    return;
  }

  if (!isSysAdmin) {
    if (roleToUpdate.isSystemAdmin || !(await isRoleLessThan(roleToUpdate, authUser))) {
      res.status(403).json({ error: 'Cannot modify a role with level equal to or above your own.' });
      return;
    }
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

  const nextIsSystemAdmin = isSystemAdmin !== undefined ? Boolean(isSystemAdmin) : roleToUpdate.isSystemAdmin;
  const nextLevel =
    level !== undefined && !Number.isNaN(Number(level))
      ? Math.max(1, Math.min(100, Math.round(Number(level))))
      : roleToUpdate.level;

  if (!isSysAdmin && !(await isRoleLessThan(nextLevel, authUser))) {
    res.status(403).json({ error: 'Cannot set role level equal to or above your own.' });
    return;
  }

  let nextPermissions: Record<string, any> | undefined;
  if (permissions !== undefined) {
    const sanitized = sanitizeRolePermissions(permissions);
    if (!sanitized.ok) {
      res.status(400).json({ error: sanitized.error });
      return;
    }
    if (!isSysAdmin) {
      const violations = findUnauthorizedGrants(authUser, sanitized.permissions, hasPermission, isRestrictedToOwn);
      if (violations.length > 0) {
        res.status(403).json({ error: 'Cannot grant permissions you do not possess.', violations });
        return;
      }
    }
    nextPermissions = sanitized.permissions;
  }

  const updatedRole = await prisma.role.update({
    where: { name },
    data: {
      description: description !== undefined ? description : roleToUpdate.description,
      level: nextLevel,
      isSystemAdmin: nextIsSystemAdmin,
      ...(nextPermissions !== undefined ? { permissions: nextPermissions } : {}),
    },
  });

  invalidateUserAuthCache();
  invalidateReferenceCache(ROLES_CACHE_KEY);
  res.json(updatedRole);
}));

router.delete('/:name', asyncHandler(async (req, res) => {
  const authUser = req.authUser;
  const isSysAdmin = isUserSystemAdmin(authUser);

  if (!hasPermission(authUser, 'roles', 'delete')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  const name = req.params.name as string;

  if (name === UserRole.ADMINISTRATOR) {
    res.status(400).json({ error: 'Cannot delete the default Administrator role.' });
    return;
  }

  const roleToDelete = await prisma.role.findUnique({
    where: { name },
    include: { _count: { select: { users: true } } },
  });

  if (!roleToDelete) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }

  if (!isSysAdmin && (roleToDelete.isSystemAdmin || !(await isRoleLessThan(roleToDelete, authUser)))) {
    res.status(403).json({ error: 'Cannot delete a role with level equal to or above your own.' });
    return;
  }

  if (roleToDelete._count?.users > 0) {
    res.status(400).json({ error: 'Cannot delete role because it is assigned to users.' });
    return;
  }

  await prisma.role.delete({ where: { name } });
  invalidateUserAuthCache();

  invalidateReferenceCache(ROLES_CACHE_KEY);
  res.json({ success: true });
}));

export default router;
