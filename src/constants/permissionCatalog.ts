export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'restore'
  | 'configure'
  | 'moderate';

export interface CatalogResource {
  id: string;
  actions: readonly PermissionAction[];
  supportsOnlyOwn?: boolean;
}

export interface CatalogApp {
  id: string;
  resources: readonly CatalogResource[];
}

export const PERMISSION_CATALOG: readonly CatalogApp[] = [
  {
    id: 'project-tracker',
    resources: [
      { id: 'tracker_projects', actions: ['view', 'create', 'edit', 'delete'], supportsOnlyOwn: true },
      { id: 'tracker_updates', actions: ['view'], supportsOnlyOwn: true },
      { id: 'tracker_reminders', actions: ['view', 'create', 'edit', 'delete'], supportsOnlyOwn: true },
      { id: 'tracker_invoices', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'wasteDisposal', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'statistics', actions: ['view'] },
      { id: 'messaging', actions: ['delete', 'moderate'] },
    ],
  },
  {
    id: 'data-management',
    resources: [
      { id: 'projects', actions: ['view', 'create', 'edit', 'delete'], supportsOnlyOwn: true },
      { id: 'clients', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'permits', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'users', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'services', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'providedServices', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'categories', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'reminders', actions: ['view', 'create', 'edit', 'delete'], supportsOnlyOwn: true },
      { id: 'invoices', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'companyInfo', actions: ['view', 'edit'] },
      { id: 'history', actions: ['view', 'restore'] },
    ],
  },
  {
    id: 'system',
    resources: [
      { id: 'roles', actions: ['view', 'create', 'edit', 'delete'] },
      { id: 'activityLogs', actions: ['view', 'delete', 'configure'] },
      { id: 'activityAnalytics', actions: ['view'] },
      { id: 'systemSettings', actions: ['view', 'edit'] },
    ],
  },
] as const;

const VALID_APP_IDS = new Set<string>(PERMISSION_CATALOG.map((app) => app.id));
const RESOURCE_MAP = new Map<string, CatalogResource>();
for (const app of PERMISSION_CATALOG) {
  for (const res of app.resources) {
    RESOURCE_MAP.set(res.id, res);
  }
}

export function sanitizeRolePermissions(
  raw: unknown
): { ok: true; permissions: Record<string, any> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, permissions: {} };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Permissions must be a JSON object.' };
  }

  const input = raw as Record<string, unknown>;
  const sanitized: Record<string, any> = {};

  if (input.apps !== undefined) {
    if (!Array.isArray(input.apps)) {
      return { ok: false, error: 'permissions.apps must be an array.' };
    }
    const validApps: string[] = [];
    for (const appId of input.apps) {
      if (typeof appId !== 'string') {
        return { ok: false, error: 'permissions.apps entries must be strings.' };
      }
      if (VALID_APP_IDS.has(appId) && !validApps.includes(appId)) {
        validApps.push(appId);
      }
    }
    sanitized.apps = validApps;
  }

  for (const [resId, resDef] of RESOURCE_MAP.entries()) {
    const rawActions = input[resId];
    if (rawActions !== undefined) {
      if (!Array.isArray(rawActions)) {
        return { ok: false, error: `permissions.${resId} must be an array of action strings.` };
      }
      const allowedActions = new Set<string>(resDef.actions);
      const validActions: string[] = [];
      for (const act of rawActions) {
        if (typeof act !== 'string') {
          return { ok: false, error: `permissions.${resId} entries must be strings.` };
        }
        if (allowedActions.has(act) && !validActions.includes(act)) {
          validActions.push(act);
        }
      }
      sanitized[resId] = validActions;
    }

    if (resDef.supportsOnlyOwn) {
      const onlyOwnKey = `${resId}_onlyOwn`;
      const rawOnlyOwn = input[onlyOwnKey];
      if (rawOnlyOwn !== undefined) {
        if (typeof rawOnlyOwn !== 'boolean') {
          return { ok: false, error: `permissions.${onlyOwnKey} must be a boolean.` };
        }
        sanitized[onlyOwnKey] = rawOnlyOwn;
      }
    }
  }

  return { ok: true, permissions: sanitized };
}

export function findUnauthorizedGrants(
  actor: any,
  permissions: Record<string, any>,
  hasPermFn: (u: any, res: string, act: string) => boolean,
  isRestrictedFn: (u: any, res: string) => boolean
): string[] {
  const violations: string[] = [];

  if (Array.isArray(permissions.apps)) {
    for (const appId of permissions.apps) {
      if (typeof appId === 'string' && !hasPermFn(actor, 'apps', appId)) {
        violations.push(`apps:${appId}`);
      }
    }
  }

  for (const [resId, resDef] of RESOURCE_MAP.entries()) {
    const grantedActions = permissions[resId];
    if (Array.isArray(grantedActions)) {
      for (const action of grantedActions) {
        if (typeof action === 'string' && !hasPermFn(actor, resId, action)) {
          violations.push(`${resId}:${action}`);
        }
      }
      if (
        resDef.supportsOnlyOwn &&
        grantedActions.length > 0 &&
        isRestrictedFn(actor, resId) &&
        permissions[`${resId}_onlyOwn`] !== true
      ) {
        violations.push(`${resId}:onlyOwn`);
      }
    }
  }

  return violations;
}
