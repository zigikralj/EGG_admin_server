import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Notifications Routes (GET, PATCH, DELETE)', () => {
  const app = createApp();

  describe('GET /api/notifications', () => {
    it('returns notifications scoped exclusively to auth user', async () => {
      const user = createTestUser({ id: 'user-notif' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        { id: 'notif-1', userId: user.id, title: 'Mentioned', read: false },
      ]);
      mockPrisma.notification.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('notifications');
      expect(res.body.notifications[0].title).toBe('Mentioned');
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: user.id }),
        })
      );
    });
  });

  describe('PATCH /api/notifications/mark-all-read', () => {
    it('marks all notifications read for auth user', async () => {
      const user = createTestUser({ id: 'user-notif' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 4 });

      const res = await request(app)
        .patch('/api/notifications/mark-all-read')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: user.id, read: false },
        data: { read: true },
      });
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks single notification read when owned by auth user', async () => {
      const user = createTestUser({ id: 'user-notif' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'notif-1',
        userId: user.id,
        read: false,
      });
      mockPrisma.notification.update.mockResolvedValueOnce({
        id: 'notif-1',
        userId: user.id,
        read: true,
      });

      const res = await request(app)
        .patch('/api/notifications/notif-1/read')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);
    });

    it('denies or returns 404/403 when notification belongs to another user', async () => {
      const user = createTestUser({ id: 'user-notif' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'notif-other',
        userId: 'other-user',
        read: false,
      });

      const res = await request(app)
        .patch('/api/notifications/notif-other/read')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/notifications/:id and /clear-all', () => {
    it('clears all notifications for current user', async () => {
      const user = createTestUser({ id: 'user-notif' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.notification.deleteMany.mockResolvedValueOnce({ count: 5 });

      const res = await request(app)
        .delete('/api/notifications/clear-all')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
    });
  });
});
