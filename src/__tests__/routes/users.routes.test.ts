import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { UserRole } from '../../types';
import { USER_STATUSES } from '../../constants';
import { clearReferenceCache } from '../../helpers/referenceCache';
import { invalidateUserAuthCache } from '../../middleware/auth';

describe('Users Routes (GET, POST, PUT, DELETE, APPROVE, REJECT, FORCE-LOGOUT)', () => {
  const app = createApp();

  beforeEach(() => {
    clearReferenceCache();
    invalidateUserAuthCache();
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.update.mockReset();
    mockPrisma.user.delete.mockReset();
    mockPrisma.user.findFirst.mockReset();
    mockPrisma.user.create.mockReset();
    mockPrisma.role.findMany.mockReset();
  });

  describe('GET /api/users', () => {
    it('returns paginated users list and strips password and granular permissions', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'u1',
          name: 'User 1',
          email: 'u1@ekos.rs',
          role: 'User',
          password: 'hashed',
          roleEntity: { name: 'User', level: 10, isSystemAdmin: false, permissions: { projects: ['view'] } },
        },
      ]);
      mockPrisma.user.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/users?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items[0]).not.toHaveProperty('password');
      expect(res.body.items[0]).not.toHaveProperty('permissions');
      expect(res.body.items[0].roleEntity).toEqual({ name: 'User', level: 10, isSystemAdmin: false });
      expect(res.body.total).toBe(1);
    });
  });

  describe('POST /api/users', () => {
    it('creates a new user by Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
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

    it('enforces strict role level hierarchy on POST: non-admin cannot assign Administrator or peer/higher roles', async () => {
      const supervisor = createTestUser({
        role: 'Supervisor',
        roleLevel: 50,
        permissions: { users: ['create'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(supervisor);

      // Cannot assign Administrator role
      const resAdmin = await request(app)
        .post('/api/users')
        .set('Authorization', createAuthHeader(supervisor))
        .send({
          name: 'Sneaky Admin',
          email: 'sneaky@ekos.rs',
          role: UserRole.ADMINISTRATOR,
        });
      expect(resAdmin.status).toBe(403);
      expect(resAdmin.body.error).toContain('Only System Administrators can assign the Administrator role');

      // Cannot assign peer role (level 50)
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.role.findMany.mockResolvedValueOnce([
        { name: 'Supervisor', level: 50, isSystemAdmin: false },
        { name: 'PeerLead', level: 50, isSystemAdmin: false },
        { name: 'Junior', level: 20, isSystemAdmin: false },
      ]);
      const resPeer = await request(app)
        .post('/api/users')
        .set('Authorization', createAuthHeader(supervisor))
        .send({
          name: 'Peer User',
          email: 'peer@ekos.rs',
          role: 'PeerLead',
        });
      expect(resPeer.status).toBe(403);
      expect(resPeer.body.error).toContain('strictly below your own level');

      // Can assign strictly lower role (level 20)
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'u-junior',
        name: 'Junior User',
        email: 'junior@ekos.rs',
        role: 'Junior',
      });
      const resLower = await request(app)
        .post('/api/users')
        .set('Authorization', createAuthHeader(supervisor))
        .send({
          name: 'Junior User',
          email: 'junior@ekos.rs',
          role: 'Junior',
        });
      expect(resLower.status).toBe(201);
    });
  });

  describe('PUT /api/users/:id', () => {
    it('enforces strict level hierarchy: non-admin cannot modify admin or peer users, nor elevate role', async () => {
      const supervisor = createTestUser({
        id: 'sup-1',
        role: 'Supervisor',
        roleLevel: 50,
        permissions: { users: ['edit'] },
      });
      const targetAdmin = createTestUser({ id: 'target-admin', role: UserRole.ADMINISTRATOR });
      const targetPeer = createTestUser({ id: 'target-peer', role: 'PeerLead', roleLevel: 50 });
      const targetLow = createTestUser({ id: 'target-low', role: 'Junior', roleLevel: 20 });

      const userMap: Record<string, any> = {
        'sup-1': supervisor,
        'target-admin': targetAdmin,
        'target-peer': targetPeer,
        'target-low': targetLow,
      };
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => userMap[where.id] ?? null);

      // Target Administrator -> 403
      const resAdmin = await request(app)
        .put('/api/users/target-admin')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ name: 'Modified Admin' });
      expect(resAdmin.status).toBe(403);
      expect(resAdmin.body.error).toContain('Only System Administrators can modify Administrator accounts');

      // Target peer (level 50) -> 403
      const resPeer = await request(app)
        .put('/api/users/target-peer')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ name: 'Modified Peer' });
      expect(resPeer.status).toBe(403);
      expect(resPeer.body.error).toContain('strictly below your own role level');

      // Target lower user (level 20) -> 200
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'target-low',
        name: 'Updated Junior',
        role: 'Junior',
        roleEntity: { level: 20, isSystemAdmin: false, permissions: {} },
      });
      const resLow = await request(app)
        .put('/api/users/target-low')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ name: 'Updated Junior' });
      expect(resLow.status).toBe(200);
    });
  });

  describe('POST /api/users/:id/approve and /reject', () => {
    it('approves a pending user for Administrator', async () => {
      const admin = createTestUser();
      const pendingTarget = createTestUser({
        id: 'target-u',
        name: 'Pending User',
        email: 'pending@ekos.rs',
        status: USER_STATUSES.PENDING,
        isApproved: false,
        role: 'User',
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);
      mockPrisma.user.findUnique.mockResolvedValueOnce(pendingTarget);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'target-u',
        name: 'Pending User',
        email: 'pending@ekos.rs',
        status: USER_STATUSES.APPROVED,
        isApproved: true,
        role: 'User',
      });

      const res = await request(app)
        .post('/api/users/target-u/approve')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(USER_STATUSES.APPROVED);
    });

    it('rejects non-pending users on approve and reject endpoints', async () => {
      const admin = createTestUser();
      const approvedTarget = createTestUser({
        id: 'approved-u',
        role: 'User',
        status: USER_STATUSES.APPROVED,
        isApproved: true,
      });
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === admin.id) return admin;
        if (where.id === 'approved-u') return approvedTarget;
        return null;
      });

      const resApprove = await request(app)
        .post('/api/users/approved-u/approve')
        .set('Authorization', createAuthHeader(admin));
      expect(resApprove.status).toBe(400);
      expect(resApprove.body.error).toContain('Only pending users');

      const resReject = await request(app)
        .post('/api/users/approved-u/reject')
        .set('Authorization', createAuthHeader(admin));
      expect(resReject.status).toBe(400);
      expect(resReject.body.error).toContain('Only pending registrations');
    });

    it('blocks non-admin from approving admin/peer targets, assigning peer role, or rejecting peer user', async () => {
      const supervisor = createTestUser({
        id: 'sup-2',
        role: 'Supervisor',
        roleLevel: 50,
        permissions: { users: ['edit'] },
      });
      const pendingLower = createTestUser({
        id: 'pending-1',
        role: 'User',
        roleLevel: 10,
        status: USER_STATUSES.PENDING,
        isApproved: false,
      });
      const peerPending = createTestUser({
        id: 'peer-pending',
        role: 'Supervisor',
        roleLevel: 50,
        status: USER_STATUSES.PENDING,
        isApproved: false,
      });
      const adminTarget = createTestUser({
        id: 'admin-target',
        role: UserRole.ADMINISTRATOR,
        status: USER_STATUSES.PENDING,
        isApproved: false,
      });

      const userMap: Record<string, any> = {
        'sup-2': supervisor,
        'pending-1': pendingLower,
        'peer-pending': peerPending,
        'admin-target': adminTarget,
      };
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => userMap[where.id] ?? null);

      mockPrisma.role.findMany.mockResolvedValueOnce([
        { name: 'Supervisor', level: 50, isSystemAdmin: false },
        { name: 'Junior', level: 20, isSystemAdmin: false },
        { name: 'User', level: 10, isSystemAdmin: false },
      ]);

      const resApproveAdminTarget = await request(app)
        .post('/api/users/admin-target/approve')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ role: 'Junior' });
      expect(resApproveAdminTarget.status).toBe(403);

      const resApprovePeerTarget = await request(app)
        .post('/api/users/peer-pending/approve')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ role: 'Junior' });
      expect(resApprovePeerTarget.status).toBe(403);

      const resApprovePeer = await request(app)
        .post('/api/users/pending-1/approve')
        .set('Authorization', createAuthHeader(supervisor))
        .send({ role: 'Supervisor' });
      expect(resApprovePeer.status).toBe(403);

      const resRejectPeer = await request(app)
        .post('/api/users/peer-pending/reject')
        .set('Authorization', createAuthHeader(supervisor));
      expect(resRejectPeer.status).toBe(403);
    });
  });

  describe('POST /api/users/:id/force-logout', () => {
    it('records timestamp in userForceLogoutMap', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'target-fl', name: 'Target User', role: 'User' });

      const res = await request(app)
        .post('/api/users/target-fl/force-logout')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('forced to log out');
    });

    it('blocks non-admin from force-logging out peer or higher user', async () => {
      const supervisor = createTestUser({
        id: 'sup-1',
        role: 'Supervisor',
        roleLevel: 50,
        permissions: { users: ['edit'] },
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(supervisor);
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        createTestUser({ id: 'peer-fl', role: 'PeerLead', roleLevel: 50 })
      );

      const res = await request(app)
        .post('/api/users/peer-fl/force-logout')
        .set('Authorization', createAuthHeader(supervisor));

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('prevents self-deletion', async () => {
      const admin = createTestUser({ id: 'admin-self' });
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);
      mockPrisma.user.findUnique.mockResolvedValueOnce(admin);

      const res = await request(app)
        .delete('/api/users/admin-self')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('delete your own account');
    });

    it('blocks non-admin from deleting user at or above own level', async () => {
      const supervisor = createTestUser({
        id: 'sup-1',
        role: 'Supervisor',
        roleLevel: 50,
        permissions: { users: ['delete'] },
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(supervisor);
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        createTestUser({ id: 'target-peer', role: 'PeerLead', roleLevel: 50 })
      );

      const res = await request(app)
        .delete('/api/users/target-peer')
        .set('Authorization', createAuthHeader(supervisor));

      expect(res.status).toBe(403);
    });
  });
});
