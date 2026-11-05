/**
 * RBAC resource and action constants for server permission checks.
 */

export const APP_SECTIONS = {
  PROJECT_TRACKER: 'project-tracker',
  DATA_MANAGEMENT: 'data-management',
} as const;

export const RESOURCES = {
  PROJECTS: 'projects',
  TRACKER_PROJECTS: 'tracker_projects',
  TRACKER_UPDATES: 'tracker_updates',
  REMINDERS: 'reminders',
  TRACKER_REMINDERS: 'tracker_reminders',
  INVOICES: 'invoices',
  TRACKER_INVOICES: 'tracker_invoices',
  CLIENTS: 'clients',
  PERMITS: 'permits',
  USERS: 'users',
  ROLES: 'roles',
  SERVICES: 'services',
  PROVIDED_SERVICES: 'providedServices',
  WASTE_DISPOSAL: 'wasteDisposal',
  CATEGORIES: 'categories',
  COMPANY_INFO: 'companyInfo',
  HISTORY: 'history',
  ACTIVITY_LOGS: 'activityLogs',
  STATISTICS: 'statistics',
  APPS: 'apps',
} as const;

export const PERMISSION_ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  RESTORE: 'restore',
} as const;
