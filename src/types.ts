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
  if (resource === 'activityLogs' || resource === 'activity_logs') {
    return role === UserRole.ADMINISTRATOR;
  }
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

export function isRestrictedToOwn(user: any, resource: string): boolean {
  if (!user) return false;
  const isSysAdmin =
    user.role === UserRole.ADMINISTRATOR ||
    Boolean(user.roleEntity?.isSystemAdmin) ||
    user.realRole === UserRole.ADMINISTRATOR ||
    Boolean(user.realRoleEntity?.isSystemAdmin);

  if (isSysAdmin) return false;

  const perms = user.roleEntity?.permissions;
  if (!perms || typeof perms !== "object") return false;

  const checkOnlyOwn = (key: string) => {
    const val = perms[key];
    if (val === true) return true;
    if (Array.isArray(val) && val.length > 0) return true;
    return false;
  };

  if (checkOnlyOwn(`${resource}_onlyOwn`)) return true;

  if (resource.startsWith("tracker_")) {
    const base = resource.replace("tracker_", "");
    if (checkOnlyOwn(`${base}_onlyOwn`)) return true;
  } else {
    if (checkOnlyOwn(`tracker_${resource}_onlyOwn`)) return true;
  }

  return false;
}
