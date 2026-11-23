import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { PERMISSION_CATALOG } from '../constants/permissionCatalog';

const router = Router();
const CATALOG_PAYLOAD = { apps: PERMISSION_CATALOG };

router.use(requireAuth);

// GET /api/permissions/catalog
router.get('/catalog', (_req, res) => {
  res.set('Cache-Control', 'private, max-age=3600');
  res.json(CATALOG_PAYLOAD);
});

export default router;
