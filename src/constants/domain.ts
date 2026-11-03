/**
 * Domain constants for server entity statuses, roles, types, and settings.
 * All selectable and stored statuses are canonical lowercase slugs.
 */

export const USER_ROLES = {
  ADMINISTRATOR: 'Administrator',
  MANAGER: 'Manager',
  USER: 'User',
  ACCOUNTANT: 'Accountant',
} as const;

export type UserRoleType = typeof USER_ROLES[keyof typeof USER_ROLES];

export const USER_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  BLOCKED: 'blocked',
  REJECTED: 'rejected',
} as const;

export type UserStatusType = typeof USER_STATUSES[keyof typeof USER_STATUSES];

export const REMINDER_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
  DRAFT: 'draft',
} as const;

export type ReminderStatusType = typeof REMINDER_STATUSES[keyof typeof REMINDER_STATUSES];

export const INVOICE_STATUSES = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const;

export type InvoiceStatusType = typeof INVOICE_STATUSES[keyof typeof INVOICE_STATUSES];

export const INVOICE_TYPES = {
  STANDARD: 'standard',
  ADVANCE: 'advance',
  FINAL: 'final',
  PARTIAL: 'partial',
} as const;

export type InvoiceTypeType = typeof INVOICE_TYPES[keyof typeof INVOICE_TYPES];

export const PROVIDED_SERVICE_STATUSES = {
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type ProvidedServiceStatusType = typeof PROVIDED_SERVICE_STATUSES[keyof typeof PROVIDED_SERVICE_STATUSES];

export const SYSTEM_SETTING_KEYS = {
  WASTE_DISPOSAL_SERVICE_ID: 'waste_disposal_service_id',
  ACTIVITY_LOGGING_ENABLED: 'activity_logging_enabled',
  ACTIVITY_LOG_RETENTION_DAYS: 'activity_log_retention_days',
} as const;

export const ENTITY_VERSION_OPS = {
  INSERT: 'I',
  UPDATE: 'U',
  DELETE: 'D',
  BASELINE: 'B',
} as const;

export const ENTITY_VERSION_KINDS = {
  SNAPSHOT: 'S',
  DELTA: 'D',
} as const;

export const isReminderCompleted = (status?: string | null): boolean => {
  return status === REMINDER_STATUSES.COMPLETED;
};

export const isInvoicePaid = (status?: string | null): boolean => {
  return status === INVOICE_STATUSES.PAID;
};

export const isProvidedServiceCompleted = (status?: string | null): boolean => {
  return status === PROVIDED_SERVICE_STATUSES.COMPLETED;
};

export const isProvidedServiceCancelled = (status?: string | null): boolean => {
  return status === PROVIDED_SERVICE_STATUSES.CANCELLED;
};

export const isInvoiceCancelled = (status?: string | null): boolean => {
  return status === INVOICE_STATUSES.CANCELLED;
};
