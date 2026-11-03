import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Reminders Routes (GET, POST, PUT, PATCH /status, DELETE)', () => {
  const app = createApp();

  describe('GET /api/reminders', () => {
    it('returns reminders and enforces pagination', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.reminder.findMany.mockResolvedValueOnce([
        { id: 'rem-1', title: 'Submit Annual Report', dueDate: '2026-12-31', status: 'Pending' },
      ]);
      mockPrisma.reminder.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/reminders?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe('POST /api/reminders', () => {
    it('creates reminder linked to project/client', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.reminder.create.mockResolvedValueOnce({
        id: 'rem-new',
        title: 'Check Permit Renewal',
        dueDate: '2027-01-15',
        status: 'Pending',
      });

      const res = await request(app)
        .post('/api/reminders')
        .set('Authorization', createAuthHeader(admin))
        .send({
          title: 'Check Permit Renewal',
          dueDate: '2027-01-15',
          status: 'Pending',
        });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Check Permit Renewal');
    });
  });

  describe('PUT /api/reminders/:id', () => {
    it('updates reminder details', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.reminder.findUnique.mockResolvedValueOnce({ id: 'rem-1', userId: admin.id });
      mockPrisma.reminder.update.mockResolvedValueOnce({
        id: 'rem-1',
        title: 'Updated Reminder Title',
      });

      const res = await request(app)
        .put('/api/reminders/rem-1')
        .set('Authorization', createAuthHeader(admin))
        .send({ title: 'Updated Reminder Title' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Reminder Title');
    });
  });

  describe('PATCH /api/reminders/:id/status', () => {
    it('updates reminder status between Pending and Done', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.reminder.findUnique.mockResolvedValueOnce({ id: 'rem-1', status: 'Pending', userId: admin.id });
      mockPrisma.reminder.update.mockResolvedValueOnce({
        id: 'rem-1',
        status: 'Done',
      });

      const res = await request(app)
        .patch('/api/reminders/rem-1/status')
        .set('Authorization', createAuthHeader(admin))
        .send({ status: 'Done' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Done');
    });
  });

  describe('DELETE /api/reminders/:id', () => {
    it('deletes reminder', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.reminder.findUnique.mockResolvedValueOnce({ id: 'rem-1', userId: admin.id });
      mockPrisma.reminder.delete.mockResolvedValueOnce({ id: 'rem-1' });

      const res = await request(app)
        .delete('/api/reminders/rem-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
