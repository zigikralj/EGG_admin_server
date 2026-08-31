import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, userForceLogoutMap, userActivityMap } from '../middleware/auth';
import { generateTempPassword, hashPassword, verifyPassword } from '../authUtils';
import { validatePassword } from '../middleware/validate';
import { UserRole } from '../types';

const router = Router();

// Require authentication for all user routes
router.use(requireAuth);

// Helper to check if a role is Admin or Manager
function isAdminOrManager(role: string): boolean {
  return role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER;
}

// GET /api/users
router.get('/', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
  });
  const now = Date.now();
  const sanitizedUsers = users.map(({ password, ...rest }) => {
    const lastActive = userActivityMap.get(rest.id);
    const isOnline = Boolean(lastActive && (now - lastActive) < 45000);
    return {
      ...rest,
      isOnline,
      lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
    };
  });
  res.json(sanitizedUsers);
}));

// POST /api/users/:id/force-logout
router.post('/:id/force-logout', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can force log out users.' });
    return;
  }

  const targetId = req.params.id as string;
  const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  userForceLogoutMap.set(targetId, Date.now());
  userActivityMap.delete(targetId);

  res.json({ success: true, message: `User ${targetUser.name} has been forced to log out.` });
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
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

  // Manager cannot create an Administrator account
  if (authUser.role === UserRole.MANAGER && targetRole === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
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
  });
  
  const { password: _, ...userWithoutPassword } = user;
  
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

  if (!isAdminOrManager(authUser.role) && !isSelf) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
    return;
  }

  const { name, email, role, phone, avatarUrl, password, currentPassword, isApproved, status, gender } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let finalRole = existingUser.role;
  if (isAdminOrManager(authUser.role)) {
    finalRole = role || existingUser.role;
  }

  // Manager cannot edit an Administrator account or upgrade someone to Administrator
  if (authUser.role === UserRole.MANAGER) {
    if (existingUser.role === UserRole.ADMINISTRATOR) {
      res.status(403).json({ error: 'Permission denied. Managers cannot modify Administrator accounts.' });
      return;
    }
    if (finalRole === UserRole.ADMINISTRATOR) {
      res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
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
    avatarUrl: avatarUrl !== undefined ? avatarUrl : (existingUser as any).avatarUrl,
    gender: gender !== undefined ? gender : (existingUser as any).gender,
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
  
  if (isAdminOrManager(authUser.role)) {
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
  });
  const { password: _, ...userWithoutPassword } = updated;
  res.json(userWithoutPassword);
}));

// POST /api/users/:id/approve
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can approve users.' });
    return;
  }

  const id = req.params.id as string;
  const { role } = req.body;
  const targetRole = role || UserRole.USER;

  if (authUser.role === UserRole.MANAGER && targetRole === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
    return;
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      isApproved: true,
      status: 'APPROVED',
      role: targetRole,
    },
  });

  const { password: _, ...userWithoutPassword } = updatedUser;
  res.json(userWithoutPassword);
}));

// POST /api/users/:id/reject
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can reject users.' });
    return;
  }

  const id = req.params.id as string;
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (authUser.role === UserRole.MANAGER && existingUser.role === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }

  await prisma.user.delete({ where: { id } });
  res.json({ message: 'Registration rejected and account removed.' });
}));

// DELETE /api/users/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isAdminOrManager(authUser.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
    return;
  }

  const id = req.params.id as string;
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Manager cannot delete an Administrator account
  if (authUser.role === UserRole.MANAGER && existingUser.role === UserRole.ADMINISTRATOR) {
    res.status(403).json({ error: 'Permission denied. Managers cannot delete Administrator accounts.' });
    return;
  }

  await prisma.user.delete({ where: { id } });
  res.json({ message: 'User deleted successfully' });
}));

export default router;
