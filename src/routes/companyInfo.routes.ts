import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { hasPermission } from '../types';

const router = Router();

// Require authentication for all company info routes
router.use(requireAuth);

// GET /api/company-info
router.get('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'companyInfo', 'view')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to view company information.' });
    return;
  }

  let info = await prisma.companyInfo.findUnique({ where: { id: 'default' } });
  if (!info) {
    info = await prisma.companyInfo.create({
      data: {
        id: 'default',
        name: 'EKOS GREEN GROUP',
        legalName: 'EKOS GREEN GROUP DOO Kraljevo',
        registrationNumber: '21823759',
        municipality: 'KRALJEVO',
        city: 'KRALJEVO',
        streetAddress: 'HEROJA MARIČIĆA 18',
        postalCode: '36000',
        postOffice: 'KRALJEVO',
        email: 'office@ekosgroup.rs',
        taxId: '113207057',
        activityCode: '7490 - Ostale stručne, naučne i tehničke delatnosti',
        bankAccounts: [
          '325-9500700212451-35',
          '205-0000000547461-12',
          '205-0070100584938-90',
          '325-9601700087442-40',
          '325-9500700218732-10',
          '205-0000000525461-52',
        ],
      },
    });
  }
  res.json(info);
}));

// PUT /api/company-info
router.put('/', asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, 'companyInfo', 'edit')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Only authorized roles can update company info.' });
    return;
  }

  const {
    name,
    legalName,
    registrationNumber,
    municipality,
    city,
    streetAddress,
    postalCode,
    postOffice,
    email,
    taxId,
    activityCode,
    bankAccounts,
  } = req.body;

  const info = await prisma.companyInfo.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      name: name || 'EKOS GREEN GROUP',
      legalName: legalName || 'EKOS GREEN GROUP DOO Kraljevo',
      registrationNumber: registrationNumber || '21823759',
      municipality: municipality || 'KRALJEVO',
      city: city || 'KRALJEVO',
      streetAddress: streetAddress || 'HEROJA MARIČIĆA 18',
      postalCode: postalCode || '36000',
      postOffice: postOffice || 'KRALJEVO',
      email: email || 'office@ekosgroup.rs',
      taxId: taxId || '113207057',
      activityCode: activityCode || '7490 - Ostale stručne, naučne i tehničke delatnosti',
      bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : [],
    },
    update: {
      name,
      legalName,
      registrationNumber,
      municipality,
      city,
      streetAddress,
      postalCode,
      postOffice,
      email,
      taxId,
      activityCode,
      bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : [],
    },
  });

  res.json(info);
}));

export default router;
