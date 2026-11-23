import { generateToken } from '../../authUtils';
import { UserRole } from '../../types';
import { USER_STATUSES } from '../../constants';

export interface TestUserOptions {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  roleLevel?: number;
  status?: string;
  isApproved?: boolean;
  permissions?: Record<string, any>;
  roleEntity?: any;
}

export function createTestUser(options: TestUserOptions = {}) {
  const role = options.role || UserRole.ADMINISTRATOR;
  const isApproved = options.isApproved !== undefined ? options.isApproved : true;
  const status = options.status || USER_STATUSES.APPROVED;
  const id = options.id || `user-${role.toLowerCase()}-${Math.random().toString(36).substring(7)}`;
  const name = options.name || `Test ${role}`;
  const email = options.email || `${role.toLowerCase()}-${Math.random().toString(36).substring(7)}@ekos.rs`;
  const isSystemAdmin = role === UserRole.ADMINISTRATOR;
  const roleLevel =
    options.roleLevel ??
    (role === UserRole.ADMINISTRATOR ? 100 : role === 'Manager' ? 50 : role === 'Accountant' ? 20 : 10);

  const defaultPerms: Record<string, any> = {
    apps: ['project-tracker', 'data-management', 'system'],
    tracker_projects: ['view', 'create', 'edit', 'delete'],
    tracker_updates: ['view'],
    tracker_reminders: ['view', 'create', 'edit', 'delete'],
    tracker_invoices: ['view', 'create', 'edit', 'delete'],
    wasteDisposal: ['view', 'create', 'edit', 'delete'],
    statistics: ['view'],
    messaging: ['delete', 'moderate'],
    projects: ['view', 'create', 'edit', 'delete'],
    clients: ['view', 'create', 'edit', 'delete'],
    invoices: ['view', 'create', 'edit', 'delete'],
    services: ['view', 'create', 'edit', 'delete'],
    providedServices: ['view', 'create', 'edit', 'delete'],
    categories: ['view', 'create', 'edit', 'delete'],
    permits: ['view', 'create', 'edit', 'delete'],
    reminders: ['view', 'create', 'edit', 'delete'],
    wasteCatalog: ['view', 'create', 'edit', 'delete'],
    users: ['view', 'create', 'edit', 'delete'],
    roles: ['view', 'create', 'edit', 'delete'],
    companyInfo: ['view', 'edit'],
    history: ['view', 'restore'],
    activityLogs: ['view', 'delete', 'configure'],
    activityAnalytics: ['view'],
    systemSettings: ['view', 'edit'],
  };

  const roleEntity = options.roleEntity !== undefined ? options.roleEntity : {
    name: role,
    description: `${role} role`,
    level: roleLevel,
    permissions: options.permissions || (isSystemAdmin ? defaultPerms : {}),
    isSystemAdmin,
  };

  return {
    id,
    name,
    email,
    password: 'hashed-password-123',
    role,
    roleLevel: roleEntity?.level ?? roleLevel,
    status,
    isApproved,
    createdAt: new Date(),
    updatedAt: new Date(),
    roleEntity,
    permissions: roleEntity.permissions,
    isSystemAdmin,
  };
}

export function createAuthHeader(user: { id: string; role?: string }) {
  const token = generateToken({
    id: user.id,
    role: user.role || UserRole.ADMINISTRATOR,
  });
  return `Bearer ${token}`;
}
