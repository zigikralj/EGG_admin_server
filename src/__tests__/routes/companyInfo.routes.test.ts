import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('CompanyInfo Routes (GET, PUT)', () => {
  const app = createApp();

  describe('GET /api/company-info', () => {
    it('returns company info record or defaults if empty', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.companyInfo.findUnique.mockResolvedValueOnce({
        id: 'default',
        name: 'Ekos Green Group d.o.o.',
        legalName: 'Ekos Green Group DOO Kraljevo',
        taxId: '113207057',
      });

      const res = await request(app)
        .get('/api/company-info')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Ekos Green Group d.o.o.');
    });
  });

  describe('PUT /api/company-info', () => {
    it('upserts singleton company info record and invalidates cache', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.companyInfo.upsert.mockResolvedValueOnce({
        id: 'default',
        name: 'Ekos Green Group Updated',
        taxId: '113207057',
      });

      const res = await request(app)
        .put('/api/company-info')
        .set('Authorization', createAuthHeader(admin))
        .send({ name: 'Ekos Green Group Updated', taxId: '113207057' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Ekos Green Group Updated');
    });
  });
});
