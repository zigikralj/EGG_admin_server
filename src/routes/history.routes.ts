import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { hasPermission } from '../types';
import {
  getEntityTimeline,
  rebuildEntityVersion,
  diffVersions,
  getChangeSetDetails,
  restoreVersion,
  normalizeEntityType,
  resolveVersionsByDate,
} from '../services/versioning.service';

const router = Router();
router.use(requireAuth);

// GET /api/history/:entityType/:id — version list with metadata & changed fields
router.get(
  '/:entityType/:id',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.authUser, 'history', 'view')) {
      res.status(403).json({ error: 'Permission denied. You cannot view history.' });
      return;
    }

    const entityType = String(req.params.entityType);
    const id = String(req.params.id);
    const norm = normalizeEntityType(entityType);
    if (!norm) {
      res.status(400).json({ error: `Unsupported entity type: ${entityType}` });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const includeChildren = req.query.includeChildren === 'true';

    const timeline = await getEntityTimeline(norm, id, { limit, offset, includeChildren });
    res.json(timeline);
  })
);

// GET /api/history/:entityType/:id/diff — field-by-field diff between two versions or dates
router.get(
  '/:entityType/:id/diff',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.authUser, 'history', 'view')) {
      res.status(403).json({ error: 'Permission denied. You cannot view history.' });
      return;
    }

    const entityType = String(req.params.entityType);
    const id = String(req.params.id);
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    let from: number;
    let to: number;

    if (dateFrom || dateTo) {
      const resolved = await resolveVersionsByDate(entityType, id, dateFrom, dateTo);
      from = resolved.from;
      to = resolved.to;
    } else {
      from = parseInt(fromStr || '', 10);
      to = parseInt(toStr || '', 10);

      if (isNaN(from) || isNaN(to)) {
        res.status(400).json({
          error: 'Either "from" and "to" version numbers, or "dateFrom" and "dateTo" parameters must be provided.',
        });
        return;
      }
    }

    const diff = await diffVersions(entityType, id, from, to);
    res.json({
      ...diff,
      dateFrom,
      dateTo,
    });
  })
);

// GET /api/history/:entityType/:id/versions/:v — reconstructed version
router.get(
  '/:entityType/:id/versions/:v',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.authUser, 'history', 'view')) {
      res.status(403).json({ error: 'Permission denied. You cannot view history.' });
      return;
    }

    const entityType = String(req.params.entityType);
    const id = String(req.params.id);
    const v = String(req.params.v);
    const targetVersion = parseInt(v, 10);

    if (isNaN(targetVersion) || targetVersion < 1) {
      res.status(400).json({ error: 'Version must be a positive integer.' });
      return;
    }

    const versionData = await rebuildEntityVersion(entityType, id, targetVersion);
    if (!versionData) {
      res.status(404).json({ error: `Version ${targetVersion} not found for ${entityType} ${id}` });
      return;
    }

    res.json(versionData);
  })
);

// GET /api/history/changesets/:id — transaction-level diff across entities
router.get(
  '/changesets/:id',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.authUser, 'history', 'view')) {
      res.status(403).json({ error: 'Permission denied. You cannot view history.' });
      return;
    }

    const changeSet = await getChangeSetDetails(String(req.params.id));
    if (!changeSet) {
      res.status(404).json({ error: 'ChangeSet not found.' });
      return;
    }

    res.json(changeSet);
  })
);

// POST /api/history/:entityType/:id/restore/:v — restore version
router.post(
  '/:entityType/:id/restore/:v',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req.authUser, 'history', 'restore')) {
      res.status(403).json({ error: 'Permission denied. You do not have permission to restore versions.' });
      return;
    }

    const entityType = String(req.params.entityType);
    const id = String(req.params.id);
    const v = String(req.params.v);
    const targetVersion = parseInt(v, 10);

    if (isNaN(targetVersion) || targetVersion < 1) {
      res.status(400).json({ error: 'Version must be a positive integer.' });
      return;
    }

    const result = await restoreVersion(entityType, id, targetVersion, {
      userId: req.authUser!.id,
      userName: req.authUser!.name || 'Unknown',
    });

    res.json(result);
  })
);

export default router;
