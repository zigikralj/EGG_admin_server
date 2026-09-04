import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { isAdminOrManager } from '../types';

const router = Router();

router.use(requireAuth);

const INITIAL_WASTE_CATALOG = [
  // 15 01 - Ambalaža (uključujući posebno sakupljenu ambalažu u komunalnom otpadu)
  { code: '15 01 01', description: 'Papirna i kartonska ambalaža', isHazardous: false },
  { code: '15 01 02', description: 'Plastična ambalaža', isHazardous: false },
  { code: '15 01 03', description: 'Drvena ambalaža', isHazardous: false },
  { code: '15 01 04', description: 'Metalna ambalaža', isHazardous: false },
  { code: '15 01 05', description: 'Kompozitna ambalaža', isHazardous: false },
  { code: '15 01 06', description: 'Mešana ambalaža', isHazardous: false },
  { code: '15 01 07', description: 'Staklena ambalaža', isHazardous: false },
  { code: '15 01 09', description: 'Tekstilna ambalaža', isHazardous: false },
  { code: '15 01 10*', description: 'Ambalaža koja sadrži ostatke opasnih supstanci ili je kontaminirana opasnim supstancama', hazardListMark: 'Y46', isHazardous: true },
  { code: '15 01 11*', description: 'Metalna ambalaža koja sadrži opasne čvrste porozne materijale (npr. azbest), uključujući prazne posude pod pritiskom', hazardListMark: 'Y46', isHazardous: true },

  // 16 - Otpadi koji nisu drugačije specificirani u listi
  { code: '16 01 03', description: 'Otpadne gume', isHazardous: false },
  { code: '16 01 04*', description: 'Istrošena motorna vozila', hazardListMark: 'Y46', isHazardous: true },
  { code: '16 01 06', description: 'Istrošena motorna vozila koja ne sadrže tečnosti i druge opasne komponente', isHazardous: false },
  { code: '16 01 07*', description: 'Uljni filteri', hazardListMark: 'Y46', isHazardous: true },
  { code: '16 01 17', description: 'Crni metali (delovi vozila)', isHazardous: false },
  { code: '16 01 18', description: 'Obojeni metali (delovi vozila)', isHazardous: false },
  { code: '16 01 19', description: 'Plastika (delovi vozila)', isHazardous: false },
  { code: '16 01 20', description: 'Staklo (delovi vozila)', isHazardous: false },
  { code: '16 02 13*', description: 'Odbačena oprema koja sadrži opasne komponente osim onih navedenih u 16 02 09 do 16 02 12', hazardListMark: 'Y46', isHazardous: true },
  { code: '16 02 14', description: 'Odbačena oprema osim one navedene u 16 02 09 do 16 02 13 (EE otpad)', isHazardous: false },
  { code: '16 06 01*', description: 'Olovne baterije (akumulatori)', hazardListMark: 'Y31', isHazardous: true },
  { code: '16 06 02*', description: 'Ni-Cd baterije', hazardListMark: 'Y26', isHazardous: true },
  { code: '16 06 04', description: 'Alkalne baterije (osim 16 06 03)', isHazardous: false },
  { code: '16 06 05', description: 'Druge baterije i akumulatori', isHazardous: false },

  // 17 - Građevinski otpad i otpad od rušenja
  { code: '17 01 01', description: 'Beton', isHazardous: false },
  { code: '17 01 02', description: 'Cigle', isHazardous: false },
  { code: '17 01 03', description: 'Crep i keramika', isHazardous: false },
  { code: '17 01 07', description: 'Mešavina betona, cigle, crepa i keramike', isHazardous: false },
  { code: '17 02 01', description: 'Drvo (građevinsko)', isHazardous: false },
  { code: '17 02 02', description: 'Staklo (građevinsko)', isHazardous: false },
  { code: '17 02 03', description: 'Plastika (građevinska)', isHazardous: false },
  { code: '17 04 01', description: 'Bakar, bronza, mesing', isHazardous: false },
  { code: '17 04 02', description: 'Aluminijum', isHazardous: false },
  { code: '17 04 05', description: 'Gvožđe i čelik', isHazardous: false },
  { code: '17 04 07', description: 'Mešani metali', isHazardous: false },
  { code: '17 05 04', description: 'Zemlja i kamen koji ne sadrže opasne supstance', isHazardous: false },
  { code: '17 06 05*', description: 'Građevinski materijali koji sadrže azbest', hazardListMark: 'Y36', isHazardous: true },

  // 19 - Otpadi iz postrojenja za upravljanje otpadom
  { code: '19 12 01', description: 'Papir i karton (mehanička obrada otpada)', isHazardous: false },
  { code: '19 12 02', description: 'Crni metali (mehanička obrada otpada)', isHazardous: false },
  { code: '19 12 03', description: 'Obojeni metali (mehanička obrada otpada)', isHazardous: false },
  { code: '19 12 04', description: 'Plastika i guma (mehanička obrada otpada)', isHazardous: false },
  { code: '19 12 07', description: 'Drvo osim onog navedenog u 19 12 06', isHazardous: false },
  { code: '19 12 12', description: 'Drugi otpadi (uključujući mešavine materijala) iz mehaničke obrade otpada osim onih navedenih u 19 12 11', isHazardous: false },

  // 20 - Komunalni otpadi (kućni otpad i slični komercijalni, industrijski i institucionalni otpadi)
  { code: '20 01 01', description: 'Papir i karton (komunalni)', isHazardous: false },
  { code: '20 01 02', description: 'Staklo (komunalno)', isHazardous: false },
  { code: '20 01 39', description: 'Plastika (komunalna)', isHazardous: false },
  { code: '20 01 40', description: 'Metali (komunalni)', isHazardous: false },
  { code: '20 03 01', description: 'Mešani komunalni otpad', isHazardous: false },
  { code: '20 03 07', description: 'Krupni (kabasti) otpad', isHazardous: false },
];

async function ensureSeed() {
  const count = await prisma.wasteCatalog.count();
  if (count === 0) {
    for (const item of INITIAL_WASTE_CATALOG) {
      await prisma.wasteCatalog.upsert({
        where: { code: item.code },
        update: {},
        create: {
          code: item.code,
          description: item.description,
          hazardListMark: item.hazardListMark || null,
          isHazardous: item.isHazardous,
        },
      });
    }
  }
}

// GET /api/waste-catalog
router.get('/', asyncHandler(async (req, res) => {
  await ensureSeed();

  const search = ((req.query.search as string) || '').trim();
  const where = search ? {
    OR: [
      { code: { contains: search, mode: 'insensitive' as const } },
      { description: { contains: search, mode: 'insensitive' as const } },
    ]
  } : {};

  const isPaginated = req.query.limit !== undefined || req.query.page !== undefined;

  const orderBy = [
    { frequent: { sort: 'asc' as const, nulls: 'last' as const } },
    { code: 'asc' as const },
  ];

  if (isPaginated) {
    const limit = req.query.limit === 'all' ? undefined : Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const skip = limit ? (page - 1) * limit : undefined;

    const [items, total] = await Promise.all([
      prisma.wasteCatalog.findMany({
        where,
        orderBy,
        take: limit,
        skip,
      }),
      prisma.wasteCatalog.count({ where }),
    ]);

    res.json({
      items,
      total,
      page,
      limit: limit || total,
      hasMore: limit ? (skip || 0) + items.length < total : false,
    });
    return;
  }

  const items = await prisma.wasteCatalog.findMany({
    where,
    orderBy,
  });

  res.json(items);
}));

// GET /api/waste-catalog/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const item = await prisma.wasteCatalog.findUnique({ where: { id } });
  if (!item) {
    res.status(404).json({ error: 'Waste catalog item not found.' });
    return;
  }
  res.json(item);
}));

// PATCH /api/waste-catalog/:id/frequent - Toggle or set frequent rank
router.patch('/:id/frequent', asyncHandler(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { frequent } = req.body || {};

  const existing = await prisma.wasteCatalog.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Waste catalog item not found.' });
    return;
  }

  let newFrequentValue: number | null;
  if (frequent === undefined) {
    // Toggle: if currently frequent, clear to null; otherwise set to 1
    newFrequentValue = existing.frequent !== null ? null : 1;
  } else if (typeof frequent === 'boolean') {
    newFrequentValue = frequent ? 1 : null;
  } else if (frequent === null || frequent === '') {
    newFrequentValue = null;
  } else {
    const parsed = parseInt(String(frequent), 10);
    newFrequentValue = isNaN(parsed) ? null : parsed;
  }

  const updated = await prisma.wasteCatalog.update({
    where: { id },
    data: { frequent: newFrequentValue },
  });

  res.json(updated);
}));

// POST /api/waste-catalog
router.post('/', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can add waste catalog items.' });
    return;
  }

  const { code, description, hazardListMark, isHazardous, frequent } = req.body || {};

  if (!code || !description) {
    res.status(400).json({ error: 'Code and description are required.' });
    return;
  }

  const frequentVal = frequent !== undefined ? (frequent === null ? null : parseInt(String(frequent), 10) || null) : undefined;

  const item = await prisma.wasteCatalog.upsert({
    where: { code: code.trim() },
    update: {
      description: description.trim(),
      hazardListMark: hazardListMark ? hazardListMark.trim() : null,
      isHazardous: Boolean(isHazardous),
      ...(frequentVal !== undefined ? { frequent: frequentVal } : {}),
    },
    create: {
      code: code.trim(),
      description: description.trim(),
      hazardListMark: hazardListMark ? hazardListMark.trim() : null,
      isHazardous: Boolean(isHazardous),
      frequent: frequentVal !== undefined ? frequentVal : null,
    },
  });

  res.status(201).json(item);
}));

export default router;
