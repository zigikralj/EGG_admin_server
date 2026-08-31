import { Router } from 'express';
import { prisma } from '../db';
import { generateToken, hashPassword, verifyPassword } from '../authUtils';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, userForceLogoutMap, userActivityMap } from '../middleware/auth';
import { validatePassword, sanitizeString } from '../middleware/validate';

const router = Router();
const SESSION_DURATION_SECONDS = 7200; // 2 hours

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { emailOrName, password } = req.body;
  if (!emailOrName || !password) {
    res.status(400).json({ error: 'Email/Username and Password are required.' });
    return;
  }

  const searchStr = emailOrName.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: searchStr, mode: 'insensitive' } },
        { name: { equals: searchStr, mode: 'insensitive' } },
      ],
    },
  });

  if (!user) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password.' });
    return;
  }

  // Verify password if user has a password set
  if (user.password) {
    const isValid = verifyPassword(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password.' });
      return;
    }

    // Automatically upgrade legacy PBKDF2 hash to bcrypt
    if (!user.password.startsWith('$2')) {
      const bcryptHash = hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: bcryptHash },
      });
    }
  }

  // Check approval status
  if (user.status === 'PENDING') {
    res.status(403).json({
      error: 'PENDING_APPROVAL',
      message: 'Your account is pending manager approval.',
    });
    return;
  }

  if (user.status === 'BLOCKED' || user.isApproved === false) {
    res.status(403).json({
      error: 'ACCOUNT_BLOCKED',
      message: 'Contact administrator for more information.',
    });
    return;
  }

  if (user.status === 'REJECTED') {
    res.status(403).json({
      error: 'ACCOUNT_REJECTED',
      message: 'Your registration request was not approved.',
    });
    return;
  }

  userForceLogoutMap.delete(user.id);
  userActivityMap.set(user.id, Date.now());
  const token = generateToken(user);
  const { password: _, ...userWithoutPassword } = user;
  res.json({ user: userWithoutPassword, token, expiresIn: SESSION_DURATION_SECONDS });
}));

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const name = sanitizeString(req.body.name);
  const email = sanitizeString(req.body.email);
  const phone = sanitizeString(req.body.phone);
  const gender = sanitizeString(req.body.gender);
  const { password } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Full name is required.' });
    return;
  }
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  if (!password) {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  const passValidation = validatePassword(password);
  if (!passValidation.valid) {
    res.status(400).json({ error: passValidation.message });
    return;
  }

  // Note: we can rely on P2002 if we add @unique to email later,
  // but keeping this manual check for now to match old behavior
  // and check both email and name.
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { name: { equals: name, mode: 'insensitive' } },
      ],
    },
  });

  if (existingUser) {
    res.status(400).json({ error: 'A user with this name or email already exists.' });
    return;
  }

  const hashedPassword = hashPassword(password);
  const newUser = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      password: hashedPassword,
      gender,
      isApproved: false,
      status: 'PENDING',
      role: 'USER', // Changed to literal to avoid enum import issues if UserRole isn't exported from types
    },
  });

  const { password: _, ...userWithoutPassword } = newUser;
  
  // Security Hardening: Do NOT issue token on registration
  res.status(201).json({
    message: 'Registration submitted successfully! Your account is pending manager approval.',
    user: userWithoutPassword,
  });
}));

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  
  if (authUser.status === 'BLOCKED' || (authUser.isApproved === false && authUser.status !== 'PENDING')) {
    res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: 'Contact administrator for more information.' });
    return;
  }
  const { password: _, ...userWithoutPassword } = authUser;
  res.json(userWithoutPassword);
}));

export default router;
