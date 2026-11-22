import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { clearReferenceCache } from '../../helpers/referenceCache';
import { invalidateUserAuthCache } from '../../middleware/auth';

describe('Roles Routes & Permissions Catalog (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  beforeEach(() => {
    clearReferenceCache();
    invalidateUserAuthCache();
  });

  describe('GET /api/permissions/catalog', () => {
    it('returns the server-owned granular permission catalog for authenticated users', async () => {
      const user = createTestUser({ role: 'User', roleLevel: 10 });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const res = await request(app)
        .get('/api/permissions/catalog')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.apps)).toBe(true);
      expect(res.body.apps.map((a: any) => a.id)).toEqual(['project-tracker', 'data-management', 'system']);
      const systemApp = res.body.apps.find((a: any) => a.id === 'system');
      expect(systemApp.resources.map((r: any) => r.id)).toEqual([
        'roles',
        'activityLogs',
        'activityAnalytics',
        'systemSettings',
      ]);
    });
  });

  describe('GET /api/roles', () => {
    it('returns all roles for Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findMany.mockResolvedValueOnce([
        { id: 'r1', name: 'Administrator', level: 100, permissions: {} },
        { id: 'r2', name: 'Supervisor', level: 50, permissions: {} },
      ]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('returns roles for regular User to resolve level labels', async () => {
      const regularUser = createTestUser({
        role: 'User',
      });
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);
      mockPrisma.role.findMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', createAuthHeader(regularUser));

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/roles', () => {
    it('creates a custom role when requested by Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce(null);
      mockPrisma.role.create.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomAuditor',
        description: 'Auditor role',
        level: 30,
        permissions: { projects: ['view'] },
      });

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'CustomAuditor',
          description: 'Auditor role',
          level: 30,
          permissions: { projects: ['view'] },
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('CustomAuditor');
      expect(res.body.level).toBe(30);
    });

    it('returns 400 when role name is missing or empty', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(admin))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Role name is required');
    });

    it('returns 400 when permissions fail catalog shape validation', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'MalformedRole',
          level: 20,
          permissions: { projects: 'not-an-array' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('permissions.projects must be an array');
    });

    it('enforces non-admin level hierarchy and permission grant ceiling on POST', async () => {
      const coordinator = createTestUser({
        id: 'coord-1',
        role: 'Coordinator',
        roleLevel: 50,
        permissions: {
          apps: ['data-management', 'system'],
          roles: ['view', 'create', 'edit', 'delete'],
          projects: ['view'],
          projects_onlyOwn: true,
        },
      });
      mockPrisma.user.findUnique.mockResolvedValue(coordinator);

      // Cannot create role at level >= own (50)
      const resLevel = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(coordinator))
        .send({
          name: 'PeerRole',
          level: 50,
          permissions: { projects: ['view'], projects_onlyOwn: true },
        });
      expect(resLevel.status).toBe(403);
      expect(resLevel.body.error).toContain('level equal to or above your own');

      // Cannot grant permissions not held or remove onlyOwn restriction
      const resCeiling = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(coordinator))
        .send({
          name: 'EscalatedRole',
          level: 30,
          permissions: {
            apps: ['data-management'],
            projects: ['view', 'delete'],
            projects_onlyOwn: false,
            clients: ['view'],
          },
        });
      expect(resCeiling.status).toBe(403);
      expect(resCeiling.body.violations).toEqual(['projects:delete', 'projects:onlyOwn', 'clients:view']);

      // Allowed when strictly below level and within own grant ceiling
      mockPrisma.role.findUnique.mockResolvedValueOnce(null);
      mockPrisma.role.create.mockResolvedValueOnce({
        id: 'r-sub',
        name: 'SubRole',
        level: 30,
        permissions: { apps: ['data-management'], projects: ['view'], projects_onlyOwn: true },
      });
      const resOk = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(coordinator))
        .send({
          name: 'SubRole',
          level: 30,
          permissions: { apps: ['data-management'], projects: ['view'], projects_onlyOwn: true },
        });
      expect(resOk.status).toBe(201);
    });
  });

  describe('PUT /api/roles/:name', () => {
    it('updates a custom role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomAuditor',
        level: 30,
        isSystemAdmin: false,
      });
      mockPrisma.role.update.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomAuditor',
        description: 'Updated description',
      });

      const res = await request(app)
        .put('/api/roles/CustomAuditor')
        .set('Authorization', createAuthHeader(admin))
        .send({ description: 'Updated description' });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Updated description');
    });

    it('prevents non-admin from editing roles at or above own level or elevating grants', async () => {
      const coordinator = createTestUser({
        id: 'coord-1',
        role: 'Coordinator',
        roleLevel: 50,
        permissions: { roles: ['view', 'edit'], projects: ['view'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(coordinator);

      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-peer',
        name: 'PeerRole',
        level: 50,
        isSystemAdmin: false,
      });
      const resPeer = await request(app)
        .put('/api/roles/PeerRole')
        .set('Authorization', createAuthHeader(coordinator))
        .send({ description: 'Attempted' });
      expect(resPeer.status).toBe(403);

      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-low',
        name: 'LowRole',
        level: 20,
        isSystemAdmin: false,
      });
      const resGrant = await request(app)
        .put('/api/roles/LowRole')
        .set('Authorization', createAuthHeader(coordinator))
        .send({ permissions: { invoices: ['edit'] } });
      expect(resGrant.status).toBe(403);
      expect(resGrant.body.violations).toContain('invoices:edit');
    });

    it('prevents removing system admin privileges from Administrator role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-admin',
        name: 'Administrator',
        level: 100,
        isSystemAdmin: true,
      });

      const res = await request(app)
        .put('/api/roles/Administrator')
        .set('Authorization', createAuthHeader(admin))
        .send({ isSystemAdmin: false });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot remove system admin privileges');
    });
  });

  describe('DELETE /api/roles/:name', () => {
    it('prevents deleting Administrator system role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .delete('/api/roles/Administrator')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot delete the default Administrator role');
    });

    it('prevents non-admin from deleting a role at or above own level', async () => {
      const coordinator = createTestUser({
        role: 'Coordinator',
        roleLevel: 50,
        permissions: { roles: ['delete'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(coordinator);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-peer',
        name: 'PeerRole',
        level: 50,
        _count: { users: 0 },
      });

      const res = await request(app)
        .delete('/api/roles/PeerRole')
        .set('Authorization', createAuthHeader(coordinator));

      expect(res.status).toBe(403);
    });

    it('prevents deleting role currently assigned to users', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomRole',
        level: 30,
        _count: { users: 3 },
      });

      const res = await request(app)
        .delete('/api/roles/CustomRole')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('assigned to users');
    });

    it('deletes unused custom role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomRole',
        level: 30,
        _count: { users: 0 },
      });
      mockPrisma.role.delete.mockResolvedValueOnce({ id: 'r-custom' });

      const res = await request(app)
        .delete('/api/roles/CustomRole')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
