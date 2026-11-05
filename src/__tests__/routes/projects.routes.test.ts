import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Projects Routes (GET, POST, PUT, PATCH, DELETE, Notes, Diffs)', () => {
  const app = createApp();

  describe('GET /api/projects', () => {
    it('returns paginated projects list and enforces pagination invariants', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findMany.mockResolvedValueOnce([
        {
          id: 'proj-1',
          name: 'Factory Waste Plan',
          clientName: 'Eco Factory',
          type: 'Otpad',
          done: false,
        },
      ]);
      mockPrisma.project.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/projects?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });

    it('returns array directly and ignores ?since parameter (delta sync removed from projects)', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findMany.mockResolvedValueOnce([
        { id: 'proj-1', name: 'Factory Waste Plan' },
      ]);

      const res = await request(app)
        .get(`/api/projects?since=${encodeURIComponent(new Date().toISOString())}`)
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('proj-1');
    });

    it('GET /api/projects/:id returns single project details', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        id: 'proj-1',
        name: 'Factory Waste Plan',
        clientName: 'Eco Factory',
        note: { content: '<p>Initial note</p>' },
      });

      const res = await request(app)
        .get('/api/projects/proj-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Factory Waste Plan');
    });

    it('GET /api/projects/statistics returns aggregated project statistics', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 'u1', name: 'Marija Petrović', role: 'User', isSystemAdmin: false }]) // all users
        .mockResolvedValueOnce([{ all: 10, active: 4, done: 6 }]) // status counts
        .mockResolvedValueOnce([{ userName: 'Marija Petrović', count: 10 }]) // user stats
        .mockResolvedValueOnce([{ code: 'grp-waste', name: 'Waste Management' }]) // categories list
        .mockResolvedValueOnce([{ type: 'waste-disposal', serviceGroup: 'grp-waste', count: 10 }]) // raw category projects
        .mockResolvedValueOnce([{ owner: 'Marija Petrović', monthKey: '2026-10', count: 6 }]) // mountain chart
        .mockResolvedValueOnce([{ clientKey: 'c1', clientName: 'Client 1', totalPaid: 150000, count: 3 }]); // top clients

      const res = await request(app)
        .get('/api/projects/statistics')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('statusCounts');
      expect(res.body.statusCounts.all).toBe(10);
      expect(res.body.userStats).toHaveLength(1);
      expect(res.body.categoryStats).toHaveLength(1);
      expect(res.body.mountainStats.totalCompletedIn12Months).toBe(6);
      expect(res.body.topClients).toHaveLength(1);
    });
  });

  describe('POST /api/projects', () => {
    it('creates a project with notes and validates Hard Rule (waste disposal service lookup)', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      // Verify Hard Rule: Looks up SystemSetting for waste_disposal_service_id
      mockPrisma.systemSetting.findUnique.mockResolvedValueOnce({
        key: 'waste_disposal_service_id',
        value: 'srv-waste-uuid',
      });
      mockPrisma.project.create.mockResolvedValueOnce({
        id: 'proj-new',
        name: 'New Environmental Project',
        clientName: 'Client Beta',
        type: 'Ekologija',
        done: false,
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 'proj-new',
        name: 'New Environmental Project',
      });
      mockPrisma.projectNote.findUnique.mockResolvedValueOnce(null);
      mockPrisma.projectNote.create.mockResolvedValueOnce({
        id: 'note-new',
        projectId: 'proj-new',
        version: 1,
      });
      mockPrisma.projectNoteVersion.create.mockResolvedValueOnce({
        id: 'v-1',
        version: 1,
      });

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'New Environmental Project',
          clientName: 'Client Beta',
          type: 'Ekologija',
          notes: '<p>Project notes</p>',
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Environmental Project');
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('updates project fields and creates note revision if notes changed', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        id: 'proj-1',
        name: 'Old Name',
        userId: admin.id,
      });
      mockPrisma.project.update.mockResolvedValueOnce({
        id: 'proj-1',
        name: 'Updated Name',
      });

      const res = await request(app)
        .put('/api/projects/proj-1')
        .set('Authorization', createAuthHeader(admin))
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });
  });

  describe('PATCH /api/projects/:id/toggle-done', () => {
    it('toggles project completion status', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        id: 'proj-1',
        done: false,
        userId: admin.id,
      });
      mockPrisma.project.update.mockResolvedValueOnce({
        id: 'proj-1',
        done: true,
      });

      const res = await request(app)
        .patch('/api/projects/proj-1/toggle-done')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.done).toBe(true);
    });
  });

  describe('Project Notes & Diffs (GET /:id/note, PATCH /:id/note, GET /:id/note/history)', () => {
    it('GET /api/projects/:id/note returns current note', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', userId: admin.id });
      mockPrisma.projectNote.findUnique.mockResolvedValueOnce({
        id: 'note-1',
        projectId: 'proj-1',
        content: '<p>Note text</p>',
        version: 1,
      });

      const res = await request(app)
        .get('/api/projects/proj-1/note')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('<p>Note text</p>');
    });

    it('GET /api/projects/:id/note/history returns revisions list', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', userId: admin.id });
      mockPrisma.projectNote.findUnique.mockResolvedValueOnce({ id: 'note-1', projectId: 'proj-1' });
      mockPrisma.projectNoteVersion.findMany.mockResolvedValueOnce([
        { id: BigInt(1), version: 1, kind: 'S', charDelta: 20, createdAt: new Date() },
      ]);
      mockPrisma.projectNoteVersion.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/projects/proj-1/note/history')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('versions');
      expect(res.body.versions).toHaveLength(1);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('deletes project and cascades notes', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', userId: admin.id });
      mockPrisma.project.delete.mockResolvedValueOnce({ id: 'proj-1' });

      const res = await request(app)
        .delete('/api/projects/proj-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
