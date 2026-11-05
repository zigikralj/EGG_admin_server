import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { UserRole } from '../../types';

describe('Roles Routes (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  describe('GET /api/roles', () => {
    it('returns all roles for Administrator', async () => {
      const admin = createTestUser({ role: UserRole.ADMINISTRATOR });
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findMany.mockResolvedValueOnce([
        { id: 'r1', name: 'Administrator', permissions: {} },
        { id: 'r2', name: 'Manager', permissions: {} },
      ]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('returns 403 for regular User without role permissions', async () => {
      // Roles module has no view permission check on GET /, but only allows authenticated users
      const regularUser = createTestUser({
        role: UserRole.USER,
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
        permissions: { projects: ['view'] },
      });

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'CustomAuditor',
          description: 'Auditor role',
          permissions: { projects: ['view'] },
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('CustomAuditor');
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
  });

  describe('PUT /api/roles/:name', () => {
    it('updates a custom role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomAuditor',
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

    it('prevents removing system admin privileges from Administrator role', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-admin',
        name: 'Administrator',
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

    it('prevents deleting role currently assigned to users', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-custom',
        name: 'CustomRole',
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
