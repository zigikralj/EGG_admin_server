import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { UserRole } from '../types';
import { SYSTEM_SETTING_KEYS } from '../constants/domain';

function isUserAdmin(authUser: any): boolean {
  if (!authUser) return false;
  return authUser.role === UserRole.ADMINISTRATOR || Boolean(authUser.roleEntity?.isSystemAdmin);
}

const router = Router();

// Require authentication for all system settings routes
router.use(requireAuth);

// GET /api/system-settings
router.get('/', asyncHandler(async (_req, res) => {
  const settings = await prisma.systemSetting.findMany();
  const settingsMap: Record<string, any> = {};
  for (const s of settings) {
    try {
      settingsMap[s.key] = JSON.parse(s.value);
    } catch {
      settingsMap[s.key] = s.value;
    }
  }

  // Enrich waste disposal service if configured
  const wasteServiceId = settingsMap[SYSTEM_SETTING_KEYS.WASTE_DISPOSAL_SERVICE_ID];
  if (wasteServiceId && typeof wasteServiceId === 'string' && wasteServiceId.trim()) {
    const service = await prisma.service.findUnique({
      where: { id: wasteServiceId.trim() },
    });
    if (service) {
      settingsMap['waste_disposal_service'] = service;
    }
  }

  res.json(settingsMap);
}));

// GET /api/system-settings/:key
router.get('/:key', asyncHandler(async (req, res) => {
  const key = req.params.key as string;
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  if (!setting) {
    res.status(404).json({ error: 'Setting not found' });
    return;
  }
  let parsedValue = setting.value;
  try {
    parsedValue = JSON.parse(setting.value);
  } catch {}
  res.json({ key: setting.key, value: parsedValue });
}));

// PUT /api/system-settings/:key (Admin only)
router.put('/:key', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!isUserAdmin(authUser)) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Only administrators can update system settings.' });
    return;
  }

  const key = req.params.key as string;
  const valueStr = typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value);

  const setting = await prisma.systemSetting.upsert({
    where: { key },
    update: { value: valueStr },
    create: { key, value: valueStr },
  });

  let parsedValue = setting.value;
  try {
    parsedValue = JSON.parse(setting.value);
  } catch {}

  res.json({ key: setting.key, value: parsedValue });
}));

export default router;

