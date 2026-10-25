import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, userForceLogoutMap, invalidateUserAuthCache } from '../middleware/auth';
import { generateTempPassword, hashPassword, verifyPassword } from '../authUtils';
import { validatePassword } from '../middleware/validate';
import { UserRole, hasPermission, isUserSystemAdmin, formatUserWithPermissions } from '../types';
import { parsePagination, buildPaginatedResponse } from '../helpers/pagination';

const router = Router();

// Require authentication for all user routes
router.use(requireAuth);

// GET /api/users
router.get('/', asyncHandler(async (req, res) => {
  // Lightweight summary for dropdowns/assignees
  if (req.query.fields === 'summary') {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        gender: true,
        status: true,
        isApproved: true,
        roleEntity: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json(users);
    return;
  }

  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;

  if (!isPaginated) {
    const users = await prisma.user.findMany({
      include: { roleEntity: true },
      orderBy: { name: 'asc' },
    });
    const sanitizedUsers = users.map((u) => formatUserWithPermissions(u));
    res.json(sanitizedUsers);
    return;
  }

  const pagination = parsePagination(req.query, {
    defaultSortBy: 'name',
    defaultSortOrder: 'asc',
    maxLimit: 100,
  });

  const search = ((req.query.search as string) || '').trim();
  const role = (req.query.role as string) || '';
  const status = (req.query.status as string) || '';

  const where: any = {};
  if (role && role !== 'all') where.role = role;
  if (status && status !== 'all') {
    if (status.toLowerCase() === 'pending') where.status = 'PENDING';
    else if (status.toLowerCase() === 'approved') where.status = 'APPROVED';
    else if (status.toLowerCase() === 'blocked') where.status = 'BLOCKED';
    else where.status = status;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['name', 'role', 'status', 'email', 'phone', 'createdAt'];
  const sortField = validSortFields.includes(pagination.sortBy) ? pagination.sortBy : 'name';

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: pagination.sortOrder },
      include: { roleEntity: true },
    }),
  ]);

  const sanitizedUsers = users.map((u) => formatUserWithPermissions(u));
  res.json(buildPaginatedResponse(sanitizedUsers, total, pagination));
}));

// POST /api/users/:id/force-logout
router.post('/:id/force-logout', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "users", "edit")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to force log out users.' });
    return;
  }

  const targetId = req.params.id as string;
  const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  userForceLogoutMap.set(targetId, Date.now());
  invalidateUserAuthCache(targetId);

  res.json({ success: true, message: `User ${targetUser.name} has been forced to log out.` });
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "users", "create")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to create users.' });
    return;
  }

  const { name, email, role, phone, password, gender } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'User name is required' });
    return;
  }

  const trimmedName = name.trim();
  const trimmedEmail = email && email.trim() ? email.trim() : null;

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { equals: trimmedName, mode: 'insensitive' } },
        ...(trimmedEmail ? [{ email: { equals: trimmedEmail, mode: 'insensitive' as const } }] : []),
      ],
    },
  });

  if (existingUser) {
    res.status(400).json({ error: 'A user with this name or email already exists.' });
    return;
  }

  const targetRole = role || UserRole.USER;

  // Non-system-admin cannot create an Administrator account
  if (!isUserSystemAdmin(authUser) && targetRole === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Only System Administrators can assign the Administrator role.' });
    return;
  }

  let finalPassword = password;
  let tempPassword = null;

  if (!finalPassword) {
    // Security hardening: Instead of 'password123', generate a secure temporary password
    tempPassword = generateTempPassword();
    finalPassword = tempPassword;
  } else {
    const passValidation = validatePassword(finalPassword);
    if (!passValidation.valid) {
      res.status(400).json({ error: passValidation.message });
      return;
    }
  }

  const hashedPassword = hashPassword(finalPassword);

  const user = await prisma.user.create({
    data: {
      name: trimmedName,
      email: trimmedEmail,
      role: targetRole,
      phone: phone ? phone.trim() : null,
      gender: gender ? gender.trim() : null,
      password: hashedPassword,
      isApproved: true,
      status: 'APPROVED',
    },
    include: { roleEntity: true },
  });
  
  const userWithoutPassword = formatUserWithPermissions(user);
  
  // Return the temporary password in the response if one was generated
  if (tempPassword) {
    res.status(201).json({ ...userWithoutPassword, tempPassword });
  } else {
    res.status(201).json(userWithoutPassword);
  }
}));

// PUT /api/users/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  const isSelf = authUser.id === id;

  if (!hasPermission(authUser, "users", "edit") && !isSelf) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to manage users.' });
    return;
  }

  const { name, email, role, phone, avatarUrl, password, currentPassword, isApproved, status, gender } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let finalRole = existingUser.role;
  if (hasPermission(authUser, "users", "edit")) {
    finalRole = role || existingUser.role;
  }

  // Non-system-admin cannot edit an Administrator account or upgrade someone to Administrator
  if (!isUserSystemAdmin(authUser)) {
    if (existingUser.role === UserRole.ADMINISTRATOR) {
      res.status(403).json({ error: 'Permission denied. Only System Administrators can modify Administrator accounts.' });
      return;
    }
    if (finalRole === UserRole.ADMINISTRATOR) {
      res.status(403).json({ error: 'Permission denied. Only System Administrators can assign the Administrator role.' });
      return;
    }
  }

  const trimmedName = name !== undefined ? name.trim() : undefined;
  const trimmedEmail = email !== undefined ? (email ? email.trim() : null) : undefined;

  if ((trimmedName && trimmedName !== existingUser.name) || (trimmedEmail !== undefined && trimmedEmail !== existingUser.email)) {
    const duplicate = await prisma.user.findFirst({
      where: {
        id: { not: id },
        OR: [
          ...(trimmedName ? [{ name: { equals: trimmedName, mode: 'insensitive' as const } }] : []),
          ...(trimmedEmail ? [{ email: { equals: trimmedEmail, mode: 'insensitive' as const } }] : []),
        ],
      },
    });
    if (duplicate) {
      res.status(400).json({ error: 'A user with this name or email already exists.' });
      return;
    }
  }

  const updatedData: any = {
    name: trimmedName !== undefined ? trimmedName : existingUser.name,
    email: trimmedEmail !== undefined ? trimmedEmail : existingUser.email,
    phone: phone !== undefined ? (phone ? phone.trim() : null) : existingUser.phone,
    avatarUrl: avatarUrl !== undefined ? avatarUrl : existingUser.avatarUrl,
    gender: gender !== undefined ? gender : existingUser.gender,
    role: finalRole,
  };

  if (password) {
    const passValidation = validatePassword(password);
    if (!passValidation.valid) {
      res.status(400).json({ error: passValidation.message });
      return;
    }
    if (isSelf && currentPassword !== undefined) {
      if (!verifyPassword(currentPassword, existingUser.password)) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }
    }
    updatedData.password = hashPassword(password);
  }
  
  if (hasPermission(authUser, "users", "edit")) {
    if (status !== undefined) {
      updatedData.status = status;
      updatedData.isApproved = status === 'APPROVED';
    } else if (isApproved !== undefined) {
      updatedData.isApproved = isApproved;
      updatedData.status = isApproved ? 'APPROVED' : 'BLOCKED';
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: updatedData,
    include: { roleEntity: true },
  });
  invalidateUserAuthCache(id);
  res.json(formatUserWithPermissions(updated));
}));

// POST /api/users/:id/approve
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "users", "edit")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to approve users.' });
    return;
  }

  const id = req.params.id as string;
  const { role } = req.body;
  const targetRole = role || UserRole.USER;

  if (!isUserSystemAdmin(authUser) && targetRole === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Only System Administrators can assign the Administrator role.' });
    return;
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      isApproved: true,
      status: 'APPROVED',
      role: targetRole,
    },
    include: { roleEntity: true },
  });
  invalidateUserAuthCache(id);

  res.json(formatUserWithPermissions(updatedUser));
}));

// POST /api/users/:id/reject
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "users", "edit")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to reject users.' });
    return;
  }

  const id = req.params.id as string;
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (!isUserSystemAdmin(authUser) && existingUser.role === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  await prisma.user.delete({ where: { id } });
  invalidateUserAuthCache(id);
  res.json({ message: 'Registration rejected and account removed.' });
}));

// DELETE /api/users/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "users", "delete")) {
    res.status(403).json({ error: 'Permission denied. You do not have permission to delete users.' });
    return;
  }

  const id = req.params.id as string;
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Non-system-admin cannot delete an Administrator account
  if (!isUserSystemAdmin(authUser) && existingUser.role === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Only System Administrators can delete Administrator accounts.' });
    return;
  }

  await prisma.user.delete({ where: { id } });
  invalidateUserAuthCache(id);
  res.json({ message: 'User deleted successfully' });
}));

export default router;
