import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { UserRole } from '../types';

const router = Router();

// Require authentication for all preferences routes
router.use(requireAuth);

// GET /api/preferences
router.get('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;

  const preferences = await prisma.userPreference.findMany({
    where: { userId: authUser.id },
  });

  const prefObj: Record<string, unknown> = {};
  for (const p of preferences) {
    try {
      prefObj[p.key] = JSON.parse(p.value);
    } catch {
      prefObj[p.key] = p.value;
    }
  }
  res.json(prefObj);
}));

// PUT /api/preferences/:key
router.put('/:key', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  const key = req.params.key as string;
  const valueStr = typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value);

  const preference = await prisma.userPreference.upsert({
    where: {
      userId_key: {
        userId: authUser.id,
        key,
      },
    },
    update: {
      value: valueStr,
    },
    create: {
      userId: authUser.id,
      key,
      value: valueStr,
    },
  });

  res.json({ key: preference.key, value: req.body.value });
}));

export default router;
