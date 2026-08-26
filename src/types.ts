export enum UserRole {
  ADMINISTRATOR = 'Administrator',
  MANAGER = 'Manager',
  USER = 'User',
  ACCOUNTANT = 'Accountant',
}

export function isAdminOrManager(role?: string | null): boolean {
  return role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER;
}

export function canManageInvoices(role?: string | null): boolean {
  return (
    role === UserRole.ADMINISTRATOR ||
    role === UserRole.MANAGER ||
    role === UserRole.ACCOUNTANT
  );
}
