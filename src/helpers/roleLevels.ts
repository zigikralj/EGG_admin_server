import { prisma } from '../db';
import { getReferenceCache, setReferenceCache } from './referenceCache';
import { UserRole } from '../types';

export const ROLES_CACHE_KEY = 'reference:roles';

export interface CachedRole {
  name: string;
  description?: string | null;
  level: number;
  isSystemAdmin: boolean;
  permissions?: any;
}

export type RoleLevelSubject =
  | number
  | string
  | {
      level?: number | null;
      roleLevel?: number | null;
      role?: string | null;
      isSystemAdmin?: boolean | null;
      roleEntity?: {
        level?: number | null;
        isSystemAdmin?: boolean | null;
      } | null;
    }
  | null
  | undefined;

export async function getRolesFromDb(): Promise<CachedRole[]> {
  const cached = getReferenceCache<CachedRole[]>(ROLES_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const roles = await prisma.role.findMany({
    orderBy: [{ level: 'desc' }, { name: 'asc' }],
  });

  if (Array.isArray(roles)) {
    setReferenceCache(ROLES_CACHE_KEY, roles);
    return roles as CachedRole[];
  }

  return [];
}

export async function getRoleLevelByName(roleName?: string | null): Promise<number | null> {
  if (!roleName) return null;
  const roles = await getRolesFromDb();
  const matched = roles.find((r) => r.name === roleName);
  return typeof matched?.level === 'number' ? matched.level : null;
}

export async function isRoleNameSystemAdmin(roleName?: string | null): Promise<boolean> {
  if (!roleName) return false;
  if (roleName === UserRole.ADMINISTRATOR) return true;
  const roles = await getRolesFromDb();
  const matched = roles.find((r) => r.name === roleName);
  return Boolean(matched?.isSystemAdmin);
}

export async function resolveRoleLevel(subject: RoleLevelSubject): Promise<number> {
  if (subject === null || subject === undefined) return 0;
  if (typeof subject === 'number') return subject;
  if (typeof subject === 'string') {
    return (await getRoleLevelByName(subject)) ?? 0;
  }
  if (typeof subject.roleEntity?.level === 'number') {
    return subject.roleEntity.level;
  }
  if (typeof subject.level === 'number') {
    return subject.level;
  }
  if (typeof subject.roleLevel === 'number') {
    return subject.roleLevel;
  }
  if (subject.role) {
    return (await getRoleLevelByName(subject.role)) ?? 0;
  }
  return 0;
}

export async function isRoleGreaterThan(actor: RoleLevelSubject, target: RoleLevelSubject): Promise<boolean> {
  const [actorLevel, targetLevel] = await Promise.all([resolveRoleLevel(actor), resolveRoleLevel(target)]);
  return actorLevel > targetLevel;
}

export async function isRoleAtLeast(actor: RoleLevelSubject, target: RoleLevelSubject): Promise<boolean> {
  const [actorLevel, targetLevel] = await Promise.all([resolveRoleLevel(actor), resolveRoleLevel(target)]);
  return actorLevel >= targetLevel;
}

export async function isRoleLessThan(actor: RoleLevelSubject, target: RoleLevelSubject): Promise<boolean> {
  const [actorLevel, targetLevel] = await Promise.all([resolveRoleLevel(actor), resolveRoleLevel(target)]);
  return actorLevel < targetLevel;
}

export async function isRoleAtMost(actor: RoleLevelSubject, target: RoleLevelSubject): Promise<boolean> {
  const [actorLevel, targetLevel] = await Promise.all([resolveRoleLevel(actor), resolveRoleLevel(target)]);
  return actorLevel <= targetLevel;
}

export async function isRoleEqualTo(actor: RoleLevelSubject, target: RoleLevelSubject): Promise<boolean> {
  const [actorLevel, targetLevel] = await Promise.all([resolveRoleLevel(actor), resolveRoleLevel(target)]);
  return actorLevel === targetLevel;
}
