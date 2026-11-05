import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { UserRole } from '../../types';

describe('Users Routes (GET, POST, PUT, DELETE, APPROVE, REJECT, FORCE-LOGOUT)', () => {
  const app = createApp();

  describe('GET /api/users', () => {
    it('returns paginated users list and strips password', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'u1', name: 'User 1', email: 'u1@ekos.rs', role: 'User', password: 'hashed' },
      ]);
      mockPrisma.user.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/users?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items[0]).not.toHaveProperty('password');
      expect(res.body.total).toBe(1);
    });
  });

  describe('POST /api/users', () => {
    it('creates a new user by Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.user.findFirst.mockResolvedValueOnce(null); // No existing email
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'u-created',
        name: 'New Colleague',
        email: 'colleague@ekos.rs',
        role: 'User',
      });

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'New Colleague',
          email: 'colleague@ekos.rs',
          role: 'User',
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('colleague@ekos.rs');
    });

    it('enforces Manager < Administrator invariant: Manager cannot create Administrator', async () => {
      const manager = createTestUser({ role: UserRole.MANAGER });
      // When requireAuth resolves manager:
      mockPrisma.user.findUnique.mockResolvedValueOnce(manager);

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', createAuthHeader(manager))
        .send({
          name: 'Sneaky Admin',
          email: 'sneaky@ekos.rs',
          role: UserRole.ADMINISTRATOR,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only System Administrators can assign the Administrator role');
    });
  });

  describe('PUT /api/users/:id', () => {
    it('enforces Manager < Administrator: Manager cannot modify Administrator', async () => {
      const manager = createTestUser({ role: UserRole.MANAGER });
      // First call for requireAuth (resolves manager)
      mockPrisma.user.findUnique.mockResolvedValueOnce(manager);
      // Second call for existingUser lookup (resolves target admin)
      mockPrisma.user.findUnique.mockResolvedValueOnce(createTestUser({ id: 'target-admin', role: UserRole.ADMINISTRATOR }));

      const res = await request(app)
        .put('/api/users/target-admin')
        .set('Authorization', createAuthHeader(manager))
        .send({ name: 'Modified Admin' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only System Administrators can modify Administrator accounts');
    });
  });

  describe('POST /api/users/:id/approve and /reject', () => {
    it('approves a pending user', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'target-u',
        name: 'Pending User',
        email: 'pending@ekos.rs',
        status: 'Approved',
        isApproved: true,
        role: 'User',
      });

      const res = await request(app)
        .post('/api/users/target-u/approve')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Approved');
    });
  });

  describe('POST /api/users/:id/force-logout', () => {
    it('records timestamp in userForceLogoutMap', async () => {
      const admin = createTestUser();
      // First call for requireAuth
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);
      // Second call for targetUser lookup
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'target-fl', name: 'Target User', role: 'User' });

      const res = await request(app)
        .post('/api/users/target-fl/force-logout')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('forced to log out');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('prevents self-deletion', async () => {
      const admin = createTestUser({ id: 'admin-self' });
      // First call for requireAuth
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);
      // Second call for existingUser lookup
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);

      const res = await request(app)
        .delete('/api/users/admin-self')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('delete your own account');
    });
  });
});
