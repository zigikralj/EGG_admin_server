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
  if (!user) return false;
  if (!user.roleEntity) {
    if (user.role === UserRole.ADMINISTRATOR) return true;
    if (resource === 'companyInfo') {
      if (action === 'view') return true;
      if (action === 'edit' || action === 'create' || action === 'delete') {
        return user.role === UserRole.ADMINISTRATOR || user.role === UserRole.MANAGER;
      }
    }
    return false;
  }
  if (user.roleEntity.isSystemAdmin) return true;
  const perms = user.roleEntity.permissions || {};
  if (!perms[resource] || !Array.isArray(perms[resource])) {
    if (resource === 'companyInfo') {
      if (action === 'view') return true;
      if (action === 'edit' || action === 'create' || action === 'delete') {
        return user.role === UserRole.ADMINISTRATOR || user.role === UserRole.MANAGER;
      }
    }
    return false;
  }
  return perms[resource].includes(action);
}
