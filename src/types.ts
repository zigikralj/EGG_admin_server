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
  // Legacy fallback ONLY if the key is undefined in perms (e.g. older role schema before separation)
  if (perms && typeof perms === 'object') {
    if (resource.startsWith('tracker_')) {
      const base = resource.replace('tracker_', '');
      if (Array.isArray(perms[base])) {
        return perms[base].includes(action);
      }
    } else if (resource === 'wasteDisposal') {
      if (Array.isArray(perms.providedServices)) {
        return perms.providedServices.includes(action);
      }
    }
  }
  return getDefaultResourcePermission(user.role, resource, action);
}

export function isRestrictedToOwn(user: any, resource: string): boolean {
  if (!user) return false;
  const isSysAdmin =
    user.role === UserRole.ADMINISTRATOR ||
    Boolean(user.roleEntity?.isSystemAdmin);

  if (isSysAdmin) return false;

  const perms = user.roleEntity?.permissions;
  if (!perms || typeof perms !== "object") return false;

  const checkOnlyOwn = (key: string) => {
    const val = perms[key];
    if (val === true) return true;
    if (Array.isArray(val) && val.length > 0) return true;
    return false;
  };

  const directKey = `${resource}_onlyOwn`;
  if (typeof perms[directKey] === 'boolean') {
    return perms[directKey];
  }
  if (checkOnlyOwn(directKey)) return true;

  // Legacy fallback ONLY if tracker_* is not configured
  if (resource.startsWith("tracker_")) {
    const base = resource.replace("tracker_", "");
    if (typeof perms[`${base}_onlyOwn`] === 'boolean') {
      return perms[`${base}_onlyOwn`];
    }
    if (checkOnlyOwn(`${base}_onlyOwn`)) return true;
  }

  return false;
}
