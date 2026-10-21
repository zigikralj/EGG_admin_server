import { diff_match_patch } from 'diff-match-patch';
import { basePrisma } from '../db';
import { extractNotesPreview } from '../routes/projects.routes';
import { handleProjectNotesMentions } from '../helpers/mentionHelper';
import { cleanWordHtml } from '../cleanWordNotes';

const dmp = new diff_match_patch();
const KEYFRAME_INTERVAL = 15;
const LARGE_DELTA_THRESHOLD = 0.6; // 60%
const MIN_CONTENT_LEN_FOR_LARGE_DELTA = 200;

export async function saveNoteRevision(params: {
  projectId: string;
  newContent: string;
  authorId?: string;
  authorName?: string;
  reason?: string;
}): Promise<{ id: string; content: string; version: number; notesPreview: string | null }> {
  const { projectId, authorId, authorName, reason } = params;
  const rawContent = params.newContent || '';
  // Defense-in-depth: strip MS Word/Office metadata and comments
  const newContent = cleanWordHtml(rawContent);

  const project = await basePrisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const result = await basePrisma.$transaction(async (tx) => {
    let note = await tx.projectNote.findUnique({
      where: { projectId },
    });

    const preview = extractNotesPreview(newContent);

    let validUpdatedById: string | null = null;
    if (authorId) {
      const userExists = await tx.user.findUnique({
        where: { id: authorId },
        select: { id: true },
      });
      if (userExists) {
        validUpdatedById = userExists.id;
      }
    }

    if (!note) {
      note = await tx.projectNote.create({
        data: {
          projectId,
          content: newContent,
          version: 1,
          updatedById: validUpdatedById,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { notesPreview: preview },
      });

      await tx.projectNoteVersion.create({
        data: {
          noteId: note.id,
          version: 1,
          kind: 'S',
          content: newContent,
          charDelta: newContent.length,
          authorId,
          authorName,
          reason: reason || 'Initial Note Creation',
        },
      });

      return {
        id: note.id,
        content: newContent,
        version: 1,
        notesPreview: preview,
        previousContent: null,
      };
    }

    const prevContent = note.content || '';

    // No-op protection
    if (prevContent === newContent) {
      return {
        id: note.id,
        content: prevContent,
        version: note.version,
        notesPreview: preview,
        previousContent: prevContent,
      };
    }

    const nextVersion = note.version + 1;

    // Generate delta patch
    const patchList = dmp.patch_make(prevContent, newContent);
    const patchText = dmp.patch_toText(patchList);
    const charDelta = newContent.length - prevContent.length;

    const isKeyframe =
      nextVersion % KEYFRAME_INTERVAL === 0 ||
      (newContent.length > MIN_CONTENT_LEN_FOR_LARGE_DELTA &&
        patchText.length > newContent.length * LARGE_DELTA_THRESHOLD);

    await tx.projectNoteVersion.create({
      data: {
        noteId: note.id,
        version: nextVersion,
        kind: isKeyframe ? 'S' : 'D',
        content: isKeyframe ? newContent : null,
        patch: isKeyframe ? null : patchText,
        charDelta,
        authorId,
        authorName,
        reason,
      },
    });

    const updatedNote = await tx.projectNote.update({
      where: { id: note.id },
      data: {
        content: newContent,
        version: nextVersion,
        updatedById: validUpdatedById,
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { notesPreview: preview },
    });

    return {
      id: updatedNote.id,
      content: newContent,
      version: nextVersion,
      notesPreview: preview,
      previousContent: prevContent,
    };
  });

  // Async mention notification dispatch
  if (result.content && authorId && authorName) {
    try {
      await handleProjectNotesMentions(
        projectId,
        project.name,
        result.content,
        result.previousContent,
        { id: authorId, name: authorName }
      );
    } catch (e) {
      console.error('Failed to dispatch project notes mentions', e);
    }
  }

  return {
    id: result.id,
    content: result.content,
    version: result.version,
    notesPreview: result.notesPreview,
  };
}

export async function reconstructNoteVersion(
  noteId: string,
  targetVersion: number
): Promise<{ version: number; content: string; createdAt: Date; authorName: string | null }> {
  if (targetVersion < 1) {
    throw new Error('Version must be a positive integer');
  }

  const snapshot = await basePrisma.projectNoteVersion.findFirst({
    where: {
      noteId,
      version: { lte: targetVersion },
      kind: 'S',
    },
    orderBy: { version: 'desc' },
  });

  if (!snapshot) {
    throw new Error(`Snapshot not found for noteId ${noteId} at or before version ${targetVersion}`);
  }

  const deltas = await basePrisma.projectNoteVersion.findMany({
    where: {
      noteId,
      version: { gt: snapshot.version, lte: targetVersion },
    },
    orderBy: { version: 'asc' },
  });

  let currentContent = snapshot.content || '';
  for (const delta of deltas) {
    if (delta.patch) {
      const patches = dmp.patch_fromText(delta.patch);
      const [applied] = dmp.patch_apply(patches, currentContent);
      currentContent = applied;
    }
  }

  const lastRecord = deltas.length > 0 ? deltas[deltas.length - 1] : snapshot;
  return {
    version: targetVersion,
    content: currentContent,
    createdAt: lastRecord.createdAt,
    authorName: lastRecord.authorName,
  };
}

export async function getNoteRevisionsList(noteId: string, limit: number = 50, offset: number = 0) {
  const [total, versions] = await Promise.all([
    basePrisma.projectNoteVersion.count({ where: { noteId } }),
    basePrisma.projectNoteVersion.findMany({
      where: { noteId },
      select: {
        id: true,
        version: true,
        kind: true,
        charDelta: true,
        authorId: true,
        authorName: true,
        reason: true,
        createdAt: true,
      },
      orderBy: { version: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      skip: Math.max(offset, 0),
    }),
  ]);

  return {
    total,
    versions: versions.map((v) => ({
      ...v,
      id: v.id.toString(),
    })),
  };
}

export async function diffNoteVersions(
  noteId: string,
  vFrom: number,
  vTo: number
): Promise<{
  vFrom: number;
  vTo: number;
  fromCreatedAt: Date;
  toCreatedAt: Date;
  diff: Array<{ op: 'insert' | 'delete' | 'equal'; text: string }>;
}> {
  const [fromVer, toVer] = await Promise.all([
    reconstructNoteVersion(noteId, vFrom),
    reconstructNoteVersion(noteId, vTo),
  ]);

  const diffTuples = dmp.diff_main(fromVer.content, toVer.content);
  dmp.diff_cleanupSemantic(diffTuples);

  const diff = diffTuples.map(([opCode, text]) => {
    const op = opCode === 1 ? 'insert' : opCode === -1 ? 'delete' : 'equal';
    return { op: op as 'insert' | 'delete' | 'equal', text };
  });

  return {
    vFrom,
    vTo,
    fromCreatedAt: fromVer.createdAt,
    toCreatedAt: toVer.createdAt,
    diff,
  };
}

export async function resolveNoteVersionsByDate(
  noteId: string,
  dateFromStr?: string,
  dateToStr?: string
): Promise<{ from: number; to: number; dateFrom?: string; dateTo?: string }> {
  const versions = await basePrisma.projectNoteVersion.findMany({
    where: { noteId },
    select: { version: true, createdAt: true },
    orderBy: { version: 'asc' },
  });

  if (versions.length === 0) {
    throw new Error(`No history versions found for noteId ${noteId}`);
  }

  const minVersion = versions[0].version;
  const maxVersion = versions[versions.length - 1].version;

  let resolvedFrom = minVersion;
  let resolvedTo = maxVersion;

  if (dateFromStr) {
    const fromDate = new Date(dateFromStr);
    const matching = versions.filter((v) => new Date(v.createdAt) <= fromDate);
    resolvedFrom = matching.length > 0 ? matching[matching.length - 1].version : minVersion;
  }

  if (dateToStr) {
    const toDate = new Date(dateToStr);
    if (dateToStr.length === 10) toDate.setHours(23, 59, 59, 999);
    const matching = versions.filter((v) => new Date(v.createdAt) <= toDate);
    resolvedTo = matching.length > 0 ? matching[matching.length - 1].version : maxVersion;
  }

  return { from: resolvedFrom, to: resolvedTo, dateFrom: dateFromStr, dateTo: dateToStr };
}

export async function restoreNoteVersion(
  projectId: string,
  targetVersion: number,
  author: { id: string; name: string }
) {
  const note = await basePrisma.projectNote.findUnique({
    where: { projectId },
  });

  if (!note) {
    throw new Error(`ProjectNote for project ${projectId} not found`);
  }

  const historical = await reconstructNoteVersion(note.id, targetVersion);

  return await saveNoteRevision({
    projectId,
    newContent: historical.content,
    authorId: author.id,
    authorName: author.name,
    reason: `Restored to version ${targetVersion} from ${historical.createdAt.toISOString()}`,
  });
}
