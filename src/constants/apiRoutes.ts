/**
 * Centralized API route definitions for the server.
 * Used for mounting routes, applying middleware, and audit logging.
 */

export const API_BASE_PREFIX = '/api';

export const API_ROUTES = {
  AUTH: {
    BASE: '/api/auth',
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
  },
  ROLES: '/api/roles',
  USERS: '/api/users',
  PROJECTS: {
    BASE: '/api/projects',
    STATS: '/api/projects/stats',
  },
  REMINDERS: '/api/reminders',
  CLIENTS: '/api/clients',
  SERVICES: '/api/services',
  CATEGORIES: '/api/categories',
  INVOICES: '/api/invoices',
  PROVIDED_SERVICES: '/api/provided-services',
  PREFERENCES: '/api/preferences',
  COMPANY_INFO: '/api/company-info',
  NOTIFICATIONS: '/api/notifications',
  PERMITS: '/api/permits',
  WASTE_CATALOG: '/api/waste-catalog',
  ACTIVITY_LOGS: {
    BASE: '/api/activity-logs',
    ANALYTICS: '/api/activity-logs/analytics',
  },
  HISTORY: '/api/history',
  IMPORT: '/api/import',
} as const;

/**
 * Maps Prisma database models to their corresponding REST API route paths.
 * Prevents discrepancies in audit and activity logging.
 */
export const PRISMA_MODEL_TO_API_ROUTE: Record<string, string> = {
  Project: API_ROUTES.PROJECTS.BASE,
  Client: API_ROUTES.CLIENTS,
  Invoice: API_ROUTES.INVOICES,
  InvoiceItem: API_ROUTES.INVOICES,
  Service: API_ROUTES.SERVICES,
  Category: API_ROUTES.CATEGORIES,
  ProvidedService: API_ROUTES.PROVIDED_SERVICES,
  Reminder: API_ROUTES.REMINDERS,
  Permit: API_ROUTES.PERMITS,
  User: API_ROUTES.USERS,
  Role: API_ROUTES.ROLES,
  WasteCatalog: API_ROUTES.WASTE_CATALOG,
  CompanyInfo: API_ROUTES.COMPANY_INFO,
  ActivityLog: API_ROUTES.ACTIVITY_LOGS.BASE,
};
