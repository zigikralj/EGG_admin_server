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

export function hasPermission(user: any, resource: string, action: string): boolean {
  if (!user || !user.roleEntity) return false;
  if (user.roleEntity.isSystemAdmin) return true;
  const perms = user.roleEntity.permissions || {};
  if (!perms[resource] || !Array.isArray(perms[resource])) return false;
  return perms[resource].includes(action);
}
