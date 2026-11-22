import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { PERMISSION_CATALOG } from '../constants/permissionCatalog';
import { getReferenceCache, setReferenceCache } from '../helpers/referenceCache';

const router = Router();
const CATALOG_CACHE_KEY = 'reference:permission-catalog';

router.use(requireAuth);

// GET /api/permissions/catalog
router.get('/catalog', (_req, res) => {
  const cached = getReferenceCache(CATALOG_CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }

  const payload = { apps: PERMISSION_CATALOG };
  setReferenceCache(CATALOG_CACHE_KEY, payload);
  res.json(payload);
});

export default router;
