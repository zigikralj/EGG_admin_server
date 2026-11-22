import { describe, it, expect, beforeEach } from 'vitest';
import { mockPrisma } from '../helpers/prismaMock';
import { clearReferenceCache } from '../../helpers/referenceCache';
import { getUserRoleLevel } from '../../types';
import {
  getRolesFromDb,
  getRoleLevelByName,
  isRoleNameSystemAdmin,
  resolveRoleLevel,
  isRoleGreaterThan,
  isRoleAtLeast,
  isRoleLessThan,
  isRoleAtMost,
  isRoleEqualTo,
} from '../../helpers/roleLevels';

describe('roleLevels helper', () => {
  beforeEach(() => {
    clearReferenceCache();
  });

  it('extracts level safely via getUserRoleLevel', () => {
    expect(getUserRoleLevel(null)).toBe(0);
    expect(getUserRoleLevel({ role: 'TeamLead', roleEntity: { level: 65 } })).toBe(65);
    expect(getUserRoleLevel({ role: 'Supervisor', roleLevel: 40 })).toBe(40);
    expect(getUserRoleLevel({ role: 'UnknownRole' })).toBe(0);
  });

  it('reads role levels and system admin flag from DB roles without hardcoded names', async () => {
    mockPrisma.role.findMany.mockResolvedValueOnce([
      { name: 'Administrator', level: 100, isSystemAdmin: true },
      { name: 'CustomLead', level: 65, isSystemAdmin: false },
      { name: 'ShadowAdmin', level: 90, isSystemAdmin: true },
      { name: 'Junior', level: 15, isSystemAdmin: false },
    ]);

    const roles = await getRolesFromDb();
    expect(roles).toHaveLength(4);
    expect(await getRoleLevelByName('CustomLead')).toBe(65);
    expect(await getRoleLevelByName('MissingRole')).toBeNull();
    expect(await isRoleNameSystemAdmin('Administrator')).toBe(true);
    expect(await isRoleNameSystemAdmin('ShadowAdmin')).toBe(true);
    expect(await isRoleNameSystemAdmin('CustomLead')).toBe(false);
    expect(await isRoleNameSystemAdmin('')).toBe(false);
  });

  it('resolves numeric, string, and object RoleLevelSubjects accurately', async () => {
    mockPrisma.role.findMany.mockResolvedValueOnce([
      { name: 'TeamLead', level: 70, isSystemAdmin: false },
    ]);

    expect(await resolveRoleLevel(null)).toBe(0);
    expect(await resolveRoleLevel(undefined)).toBe(0);
    expect(await resolveRoleLevel(42)).toBe(42);
    expect(await resolveRoleLevel('TeamLead')).toBe(70);
    expect(await resolveRoleLevel('NonExistent')).toBe(0);
    expect(await resolveRoleLevel({ roleEntity: { level: 55 } })).toBe(55);
    expect(await resolveRoleLevel({ level: 35 })).toBe(35);
    expect(await resolveRoleLevel({ roleLevel: 25 })).toBe(25);
    expect(await resolveRoleLevel({ role: 'TeamLead' })).toBe(70);
  });

  it('evaluates generic comparison helpers consistently across levels and DB roles', async () => {
    mockPrisma.role.findMany.mockResolvedValueOnce([
      { name: 'Director', level: 80, isSystemAdmin: false },
      { name: 'Lead', level: 50, isSystemAdmin: false },
      { name: 'PeerLead', level: 50, isSystemAdmin: false },
      { name: 'Associate', level: 20, isSystemAdmin: false },
    ]);

    const director = { role: 'Director', roleLevel: 80 };
    const lead = { role: 'Lead', roleEntity: { level: 50 } };
    const associate = { role: 'Associate', roleEntity: { level: 20 } };

    expect(await isRoleGreaterThan(director, lead)).toBe(true);
    expect(await isRoleGreaterThan(lead, 'PeerLead')).toBe(false);
    expect(await isRoleAtLeast(lead, 'PeerLead')).toBe(true);
    expect(await isRoleAtLeast(associate, lead)).toBe(false);
    expect(await isRoleLessThan(associate, lead)).toBe(true);
    expect(await isRoleLessThan(lead, 'PeerLead')).toBe(false);
    expect(await isRoleAtMost(lead, 'PeerLead')).toBe(true);
    expect(await isRoleAtMost(director, lead)).toBe(false);
    expect(await isRoleEqualTo(lead, 'PeerLead')).toBe(true);
    expect(await isRoleEqualTo(director, associate)).toBe(false);
  });
});
