import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { UserRole } from '../../types';

describe('Contracts & Contract Templates Routes', () => {
  const app = createApp();

  beforeEach(() => {
    // Note: mockPrisma already auto-resets between tests via setupTests.ts
  });

  describe('GET /api/contracts', () => {
    it('returns paginated contracts for authenticated users', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const mockContracts = [
        {
          id: 'contract-1',
          contractNumber: 'UGOV-2026-001',
          title: 'Ugovor o zbrinjavanju otpada',
          clientId: 'client-1',
          clientName: 'Test Client DOO',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'Active',
          reminders: [],
        },
      ];

      mockPrisma.contract.count.mockResolvedValue(1);
      mockPrisma.contract.findMany.mockResolvedValue(mockContracts);

      const res = await request(app)
        .get('/api/contracts?page=1&limit=25')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].contractNumber).toBe('UGOV-2026-001');
      expect(res.body.total).toBe(1);
    });
  });

  describe('POST /api/contracts', () => {
    it('creates contract and automatically syncs 45-day reminder', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const payload = {
        contractNumber: 'UGOV-2026-002',
        title: 'Godišnji ugovor',
        clientId: 'client-1',
        clientName: 'Test Client DOO',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'Active',
        content: '<p>Contract content</p>',
      };

      const createdContract = {
        id: 'contract-2',
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.contract.create.mockResolvedValue(createdContract);
      mockPrisma.reminder.findFirst.mockResolvedValue(null);
      mockPrisma.reminder.create.mockResolvedValue({
        id: 'rem-auto-1',
        contractId: 'contract-2',
        dueDate: '2026-11-16', // 2026-12-31 minus 45 days
        isAutoContractReminder: true,
      });
      mockPrisma.contract.findUnique.mockResolvedValue({
        ...createdContract,
        reminders: [
          {
            id: 'rem-auto-1',
            contractId: 'contract-2',
            dueDate: '2026-11-16',
            isAutoContractReminder: true,
          },
        ],
      });

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', createAuthHeader(admin))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.contractNumber).toBe('UGOV-2026-002');
      expect(mockPrisma.reminder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'contract-2',
            dueDate: '2026-11-16',
            isAutoContractReminder: true,
          }),
        })
      );
    });

    it('denies user without permission', async () => {
      const normalUser = createTestUser({
        id: 'user-normal',
        role: UserRole.USER,
        name: 'Normal User',
        permissions: {},
      });
      mockPrisma.user.findUnique.mockResolvedValue(normalUser);

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', createAuthHeader(normalUser))
        .send({
          contractNumber: 'UGOV-2026-003',
          title: 'Test',
          clientId: 'client-1',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Contract Templates CRUD', () => {
    it('creates and lists contract templates', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const templateData = {
        name: 'Standardna klauzula o poverljivosti',
        category: 'Boilerplate',
        description: 'NDA klauzula',
        content: '<p>Član 1. Ugovorne strane se obavezuju na poverljivost...</p>',
      };

      mockPrisma.contractTemplate.create.mockResolvedValue({
        id: 'tpl-1',
        ...templateData,
      });

      const createRes = await request(app)
        .post('/api/contract-templates')
        .set('Authorization', createAuthHeader(admin))
        .send(templateData);

      expect(createRes.status).toBe(201);
      expect(createRes.body.name).toBe(templateData.name);

      mockPrisma.contractTemplate.count.mockResolvedValue(1);
      mockPrisma.contractTemplate.findMany.mockResolvedValue([
        { id: 'tpl-1', ...templateData },
      ]);

      const listRes = await request(app)
        .get('/api/contract-templates?page=1&limit=25')
        .set('Authorization', createAuthHeader(admin));

      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);
    });
  });
});
