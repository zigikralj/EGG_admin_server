import { describe, it, expect } from 'vitest';
import {
  PERMISSION_CATALOG,
  sanitizeRolePermissions,
  findUnauthorizedGrants,
} from '../../constants/permissionCatalog';
import { hasPermission, isRestrictedToOwn } from '../../types';

describe('permissionCatalog helpers', () => {
  it('exposes project-tracker, data-management, and system apps in PERMISSION_CATALOG', () => {
    expect(PERMISSION_CATALOG.map((a) => a.id)).toEqual(['project-tracker', 'data-management', 'system']);

    const systemApp = PERMISSION_CATALOG.find((a) => a.id === 'system');
    expect(systemApp?.resources.map((r) => r.id)).toEqual([
      'roles',
      'activityLogs',
      'activityAnalytics',
      'systemSettings',
    ]);
  });

  describe('sanitizeRolePermissions', () => {
    it('accepts empty/null/undefined input as empty permissions object', () => {
      expect(sanitizeRolePermissions(undefined)).toEqual({ ok: true, permissions: {} });
      expect(sanitizeRolePermissions(null)).toEqual({ ok: true, permissions: {} });
    });

    it('rejects non-object root values and malformed nested fields', () => {
      expect(sanitizeRolePermissions('bad')).toEqual({ ok: false, error: 'Permissions must be a JSON object.' });
      expect(sanitizeRolePermissions([])).toEqual({ ok: false, error: 'Permissions must be a JSON object.' });
      expect(sanitizeRolePermissions({ apps: 'system' })).toEqual({
        ok: false,
        error: 'permissions.apps must be an array.',
      });
      expect(sanitizeRolePermissions({ apps: [123] })).toEqual({
        ok: false,
        error: 'permissions.apps entries must be strings.',
      });
      expect(sanitizeRolePermissions({ projects: 'view' })).toEqual({
        ok: false,
        error: 'permissions.projects must be an array of action strings.',
      });
      expect(sanitizeRolePermissions({ projects: [42] })).toEqual({
        ok: false,
        error: 'permissions.projects entries must be strings.',
      });
      expect(sanitizeRolePermissions({ projects_onlyOwn: 'true' })).toEqual({
        ok: false,
        error: 'permissions.projects_onlyOwn must be a boolean.',
      });
    });

    it('strips unknown apps, unknown resources, invalid actions, duplicates, and non-onlyOwn flags', () => {
      const result = sanitizeRolePermissions({
        apps: ['project-tracker', 'unknown-app', 'project-tracker', 'system'],
        projects: ['view', 'view', 'invalidAction', 'edit'],
        projects_onlyOwn: true,
        chat: ['delete', 'view', 'moderate'],
        roles: ['view', 'create'],
        roles_onlyOwn: true, // roles does not support onlyOwn -> stripped
        unknownResource: ['view'],
      });

      expect(result).toEqual({
        ok: true,
        permissions: {
          apps: ['project-tracker', 'system'],
          projects: ['view', 'edit'],
          projects_onlyOwn: true,
          chat: ['delete', 'moderate'],
          roles: ['view', 'create'],
        },
      });
    });
  });

  describe('findUnauthorizedGrants', () => {
    it('flags apps, resource actions, and removed onlyOwn restrictions that actor does not hold', () => {
      const actor = {
        id: 'actor-1',
        role: 'Coordinator',
        isSystemAdmin: false,
        permissions: {
          apps: ['project-tracker'],
          tracker_projects: ['view', 'edit'],
          tracker_projects_onlyOwn: true,
        },
      };

      const attempted = {
        apps: ['project-tracker', 'system'],
        tracker_projects: ['view', 'delete'],
        tracker_projects_onlyOwn: false,
        roles: ['edit'],
      };

      const violations = findUnauthorizedGrants(actor, attempted, hasPermission, isRestrictedToOwn);
      expect(violations).toEqual([
        'apps:system',
        'tracker_projects:delete',
        'tracker_projects:onlyOwn',
        'roles:edit',
      ]);
    });

    it('allows granting subset of permissions while preserving onlyOwn restriction', () => {
      const actor = {
        id: 'actor-1',
        role: 'Coordinator',
        isSystemAdmin: false,
        permissions: {
          apps: ['project-tracker', 'data-management'],
          tracker_projects: ['view', 'create', 'edit'],
          tracker_projects_onlyOwn: true,
          clients: ['view'],
        },
      };

      const attempted = {
        apps: ['project-tracker'],
        tracker_projects: ['view'],
        tracker_projects_onlyOwn: true,
        clients: ['view'],
      };

      expect(findUnauthorizedGrants(actor, attempted, hasPermission, isRestrictedToOwn)).toEqual([]);
    });
  });
});
