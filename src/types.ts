export enum UserRole {
  ADMINISTRATOR = 'Administrator',
  USER = 'User',
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  roleLevel?: number;
  isApproved?: boolean;
  status?: string;
  isSystemAdmin?: boolean;
  permissions?: Record<string, any>;
  roleEntity?: {
    name?: string;
    level?: number;
    isSystemAdmin?: boolean;
    permissions?: any;
  } | null;
  [key: string]: any;
}

export function getUserPermissions(user: any): Record<string, any> | undefined {
  if (!user) return undefined;
  if (user.permissions && typeof user.permissions === 'object') {
    return user.permissions;
  }
  if (user.roleEntity?.permissions && typeof user.roleEntity.permissions === 'object') {
    return user.roleEntity.permissions;
  }
  return undefined;
}

export function isUserSystemAdmin(user: any): boolean {
  if (!user) return false;
  return (
    user.role === UserRole.ADMINISTRATOR ||
    Boolean(user.isSystemAdmin) ||
    Boolean(user.roleEntity?.isSystemAdmin)
  );
}

export function getUserRoleLevel(user: any): number {
  if (!user) return 0;
  if (typeof user.roleEntity?.level === 'number') {
    return user.roleEntity.level;
  }
  if (typeof user.roleLevel === 'number') {
    return user.roleLevel;
  }
  return 0;
}

export function hasMinRoleLevel(user: any, minLevel: number): boolean {
  return getUserRoleLevel(user) >= minLevel;
}

export function formatUserWithPermissions<T extends Record<string, any>>(user: T) {
  const { password: _, ...userWithoutPassword } = user;
  const isSystemAdmin = isUserSystemAdmin(user);
  const roleLevel = getUserRoleLevel(user);
  const permissions = getUserPermissions(user) ?? {};
  return {
    ...userWithoutPassword,
    isSystemAdmin,
    roleLevel,
    permissions,
  };
}

export function hasPermission(user: any, resource: string, action: string): boolean {
  if (!user) return false;
  if (isUserSystemAdmin(user)) {
    return true;
  }
  const perms = getUserPermissions(user);
  if (perms && typeof perms === 'object') {
    if (Array.isArray(perms[resource]) && perms[resource].includes(action)) {
      return true;
    }
  }
  return false;
}

export function isRestrictedToOwn(user: any, resource: string): boolean {
  if (!user) return false;
  if (isUserSystemAdmin(user)) return false;

  const perms = getUserPermissions(user);
  if (!perms || typeof perms !== 'object') return false;

  const directKey = `${resource}_onlyOwn`;
  const val = perms[directKey];
  if (typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val) && val.length > 0) {
    return true;
  }

  return false;
}
