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

export function getDefaultResourcePermission(role?: string | null, resource?: string, action?: string): boolean {
  if (role === UserRole.ADMINISTRATOR || role === UserRole.MANAGER) return true;
  return false;
}

export function hasPermission(user: any, resource: string, action: string): boolean {
  if (!user) return false;
  if (user.role === UserRole.ADMINISTRATOR || user.roleEntity?.isSystemAdmin) {
    return true;
  }
  const perms = user.roleEntity?.permissions;
  if (perms && typeof perms === 'object' && Array.isArray(perms[resource])) {
    return perms[resource].includes(action);
  }
  return getDefaultResourcePermission(user.role, resource, action);
}

