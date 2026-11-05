import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveNoteRevision,
  reconstructNoteVersion,
  diffNoteVersions,
  restoreNoteVersion,
} from '../../services/noteDelta.service';
import { mockPrisma } from '../helpers/prismaMock';

describe('noteDelta.service', () => {
  const projectId = 'proj-test-123';
  const noteId = 'note-test-123';

  beforeEach(() => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, name: 'Test Project' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
  });

  it('creates initial note revision (v1) with kind S (Snapshot)', async () => {
    mockPrisma.projectNote.findUnique.mockResolvedValueOnce(null);
    mockPrisma.projectNote.create.mockResolvedValueOnce({
      id: noteId,
      projectId,
      content: '<p>Initial note</p>',
      version: 1,
      notesPreview: 'Initial note',
    });
    mockPrisma.projectNoteVersion.create.mockResolvedValueOnce({
      id: 'v-1',
      noteId,
      version: 1,
      kind: 'S',
      content: '<p>Initial note</p>',
    });

    const result = await saveNoteRevision({
      projectId,
      newContent: '<p>Initial note</p>',
      authorId: 'user-1',
      authorName: 'User One',
    });

    expect(result.version).toBe(1);
    expect(result.content).toBe('<p>Initial note</p>');
    expect(mockPrisma.projectNoteVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          kind: 'S',
          content: '<p>Initial note</p>',
        }),
      })
    );
  });

  it('handles no-op edit without incrementing version when content is identical', async () => {
    mockPrisma.projectNote.findUnique.mockResolvedValueOnce({
      id: noteId,
      projectId,
      content: '<p>Same note</p>',
      version: 1,
      notesPreview: 'Same note',
    });

    const result = await saveNoteRevision({
      projectId,
      newContent: '<p>Same note</p>',
      authorId: 'user-1',
    });

    expect(result.version).toBe(1);
    expect(mockPrisma.projectNoteVersion.create).not.toHaveBeenCalled();
  });

  it('reconstructs keyframe version (kind S) directly', async () => {
    mockPrisma.projectNoteVersion.findFirst.mockResolvedValueOnce({
      id: 'v-1',
      noteId,
      version: 1,
      kind: 'S',
      content: '<p>Keyframe text</p>',
      patch: null,
      createdAt: new Date(),
      authorName: 'User One',
    });
    mockPrisma.projectNoteVersion.findMany.mockResolvedValueOnce([]);

    const rec = await reconstructNoteVersion(noteId, 1);
    expect(rec.content).toBe('<p>Keyframe text</p>');
  });

  it('computes diff between two versions', async () => {
    mockPrisma.projectNoteVersion.findFirst
      .mockResolvedValueOnce({
        id: 'v-1',
        noteId,
        version: 1,
        kind: 'S',
        content: 'Hello World',
        createdAt: new Date(),
        authorName: 'User One',
      })
      .mockResolvedValueOnce({
        id: 'v-2',
        noteId,
        version: 2,
        kind: 'S',
        content: 'Hello Beautiful World',
        createdAt: new Date(),
        authorName: 'User One',
      });
    mockPrisma.projectNoteVersion.findMany.mockResolvedValue([]);

    const diffResult = await diffNoteVersions(noteId, 1, 2);
    expect(diffResult.vFrom).toBe(1);
    expect(diffResult.vTo).toBe(2);
    expect(Array.isArray(diffResult.diff)).toBe(true);
  });

  it('restores historical version and increments version counter', async () => {
    mockPrisma.projectNote.findUnique.mockResolvedValue({
      id: noteId,
      projectId,
      content: '<p>Current content</p>',
      version: 2,
    });
    mockPrisma.projectNoteVersion.findFirst.mockResolvedValueOnce({
      id: 'v-1',
      noteId,
      version: 1,
      kind: 'S',
      content: '<p>Original v1 content</p>',
      createdAt: new Date(),
      authorName: 'User One',
    });
    mockPrisma.projectNoteVersion.findMany.mockResolvedValue([]);

    mockPrisma.projectNote.update.mockResolvedValueOnce({
      id: noteId,
      projectId,
      content: '<p>Original v1 content</p>',
      version: 3,
      notesPreview: 'Original v1 content',
    });
    mockPrisma.projectNoteVersion.create.mockResolvedValueOnce({
      id: 'v-3',
      noteId,
      version: 3,
      kind: 'S',
      content: '<p>Original v1 content</p>',
    });

    const restored = await restoreNoteVersion(projectId, 1, { id: 'user-1', name: 'User One' });
    expect(restored.version).toBe(3);
    expect(restored.content).toBe('<p>Original v1 content</p>');
  });
});
