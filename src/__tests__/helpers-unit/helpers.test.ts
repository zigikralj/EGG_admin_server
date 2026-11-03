import { describe, it, expect } from 'vitest';
import { extractMentionedUserIds, handleProjectNotesMentions } from '../../helpers/mentionHelper';
import { addMonths, daysUntil, isStale } from '../../helpers/dateUtils';
import { mockPrisma } from '../helpers/prismaMock';

describe('mentionHelper', () => {
  it('extracts mentioned user IDs from HTML string', async () => {
    const html = '<p>Hello <span data-type="mention" data-id="user-123">@Alice</span> and <span data-type="mention" data-id="user-456">@Bob</span></p>';
    const userIds = await extractMentionedUserIds(html);
    expect(userIds).toEqual(['user-123', 'user-456']);
  });

  it('filters out author from notifications and creates Notification rows', async () => {
    const html = '<p><span data-type="mention" data-id="user-other">@Other</span></p>';
    // First call: activeUsers (because notes contains '@')
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: 'user-other', name: 'Other User', email: 'other@ekos.rs' },
    ]);
    // Second call: targetUsers
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: 'user-other', name: 'Other User' },
    ]);
    mockPrisma.notification.createMany.mockResolvedValueOnce({ count: 1 });

    await handleProjectNotesMentions(
      'proj-1',
      'Test Project',
      html,
      null,
      { id: 'user-author', name: 'Author Name' }
    );

    expect(mockPrisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'user-other',
          authorId: 'user-author',
          projectId: 'proj-1',
        }),
      ],
    });
  });
});

describe('dateUtils', () => {
  it('addMonths adds months correctly across years', () => {
    const result = addMonths('2026-10-15', 5);
    expect(result).toBe('2027-03-15');
  });

  it('daysUntil calculates difference in days', () => {
    const target = addMonths(new Date().toISOString().slice(0, 10), 1);
    const days = daysUntil(target);
    expect(days).toBeGreaterThan(25);
  });

  it('isStale correctly flags older projects', () => {
    const oldDate = '2020-01-01';
    expect(isStale({ done: false, start: oldDate })).toBe(true);
    expect(isStale({ done: true, start: oldDate })).toBe(false);
  });
});
