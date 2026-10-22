import { basePrisma } from '../db';
import {
  saveNoteRevision,
  reconstructNoteVersion,
  getNoteRevisionsList,
  diffNoteVersions,
  resolveNoteVersionsByDate,
  restoreNoteVersion,
} from './noteDelta.service';

async function runTests() {
  console.log('--- Starting noteDelta.service Integration Tests ---');

  // 1. Create a dummy project for testing
  const testProject = await basePrisma.project.create({
    data: {
      name: 'Delta Test Project ' + Date.now(),
      clientName: 'Test Client',
      type: 'Ekologija',
    },
  });

  const projectId = testProject.id;
  console.log('Created test project:', projectId);

  try {
    // Test 1: Initial note creation (Version 1, kind = 'S')
    const initialText = '<h1>Initial Project Notes</h1><p>This is paragraph 1.</p>';
    const v1 = await saveNoteRevision({
      projectId,
      newContent: initialText,
      authorId: 'test-user-1',
      authorName: 'Test User',
      reason: 'Initial creation',
    });

    console.log('Test 1 - Initial note created:', v1);
    if (v1.version !== 1) throw new Error(`Expected v1, got ${v1.version}`);
    if (v1.content !== initialText) throw new Error('Content mismatch in v1');

    const noteRecord = await basePrisma.projectNote.findUnique({
      where: { projectId },
      include: { versions: true },
    });
    if (!noteRecord || noteRecord.versions.length !== 1) throw new Error('Expected 1 version row');
    if (noteRecord.versions[0].kind !== 'S') throw new Error('Expected version 1 to be kind S');
    console.log('✓ Test 1 passed: Version 1 created as Keyframe Snapshot (kind=S)');

    // Test 2: No-op protection (same content)
    const v1NoOp = await saveNoteRevision({
      projectId,
      newContent: initialText,
      authorId: 'test-user-1',
    });
    if (v1NoOp.version !== 1) throw new Error('Expected version to remain 1 on no-op');
    const versionsAfterNoOp = await basePrisma.projectNoteVersion.count({ where: { noteId: noteRecord.id } });
    if (versionsAfterNoOp !== 1) throw new Error('Expected version count to remain 1 after no-op');
    console.log('✓ Test 2 passed: No-op protection prevented unnecessary version increment');

    // Test 3: Minor delta edit (Version 2, kind = 'D')
    const v2Text = '<h1>Initial Project Notes</h1><p>This is paragraph 1 with extra details.</p>';
    const v2 = await saveNoteRevision({
      projectId,
      newContent: v2Text,
      authorId: 'test-user-1',
      reason: 'Added extra details',
    });
    console.log('Test 3 - Version 2 created:', v2);
    if (v2.version !== 2) throw new Error(`Expected v2, got ${v2.version}`);

    const v2Record = await basePrisma.projectNoteVersion.findUnique({
      where: { noteId_version: { noteId: noteRecord.id, version: 2 } },
    });
    if (!v2Record || v2Record.kind !== 'D') throw new Error('Expected version 2 to be kind D (Delta)');
    if (!v2Record.patch || v2Record.content !== null) throw new Error('Expected patch populated and content null for delta');
    console.log('✓ Test 3 passed: Version 2 created as Compact Patch (kind=D), patch length:', v2Record.patch.length);

    // Test 4: Reconstruct Version 1 from historical snapshot
    const reconstructedV1 = await reconstructNoteVersion(noteRecord.id, 1);
    if (reconstructedV1.content !== initialText) throw new Error('Reconstructed V1 does not match original V1 content');
    console.log('✓ Test 4a passed: Reconstructed V1 matches original baseline');

    // Test 5: Reconstruct Version 2 by applying delta patch over V1
    const reconstructedV2 = await reconstructNoteVersion(noteRecord.id, 2);
    if (reconstructedV2.content !== v2Text) throw new Error('Reconstructed V2 does not match V2 text');
    console.log('✓ Test 4b passed: Reconstructed V2 from delta patch matches target text');

    // Test 6: Diff between Version 1 and Version 2
    const diff = await diffNoteVersions(noteRecord.id, 1, 2);
    console.log('Test 6 - Diff between v1 and v2:', diff.diff);
    const hasInsert = diff.diff.some(d => d.op === 'insert' && d.text.includes('with extra details'));
    if (!hasInsert) throw new Error('Expected diff to contain insert with extra details');
    console.log('✓ Test 6 passed: Semantic diff accurately detected additions');

    // Test 7: Revision list pagination
    const list = await getNoteRevisionsList(noteRecord.id);
    if (list.total !== 2 || list.versions.length !== 2) throw new Error('Expected 2 revisions in list');
    console.log('✓ Test 7 passed: Revisions list retrieved with correct pagination and counts');

    // Test 8: Date resolution
    const dateRes = await resolveNoteVersionsByDate(noteRecord.id, new Date(Date.now() - 60000).toISOString(), new Date().toISOString());
    if (dateRes.from !== 1 || dateRes.to !== 2) throw new Error(`Expected date range [1, 2], got [${dateRes.from}, ${dateRes.to}]`);
    console.log('✓ Test 8 passed: Date resolution mapped accurately to versions');

    // Test 9: Restore Version 1
    const restored = await restoreNoteVersion(projectId, 1, { id: 'test-user-1', name: 'Test User' });
    if (restored.version !== 3) throw new Error(`Expected version 3 on restore, got ${restored.version}`);
    if (restored.content !== initialText) throw new Error('Restored content does not match V1 content');
    console.log('✓ Test 9 passed: 1-click restore successfully reverted note to Version 1 as Version 3');

    // Test 10: Automatic Keyframe at version 15
    for (let i = 4; i <= 15; i++) {
      await saveNoteRevision({
        projectId,
        newContent: `<p>Version ${i} text with unique hash ${Math.random()}</p>`,
        authorId: 'test-user-1',
      });
    }
    const v15 = await basePrisma.projectNoteVersion.findUnique({
      where: { noteId_version: { noteId: noteRecord.id, version: 15 } },
    });
    if (!v15 || v15.kind !== 'S') throw new Error(`Expected version 15 to be Keyframe (S), got ${v15?.kind}`);
    if (!v15.content) throw new Error('Expected full content stored on version 15 keyframe');
    console.log('✓ Test 10 passed: Version 15 correctly stored as Keyframe Snapshot (kind=S)');

    // Test 11: Large churn (>60% on text > 200 chars) creates Keyframe
    const longBase = '<p>' + 'A'.repeat(300) + '</p>';
    await saveNoteRevision({ projectId, newContent: longBase, authorId: 'test-user-1' }); // v16 (D)
    const longReplaced = '<p>' + 'B'.repeat(300) + '</p>';
    await saveNoteRevision({ projectId, newContent: longReplaced, authorId: 'test-user-1' }); // v17 (S due to 100% replacement)
    const v17 = await basePrisma.projectNoteVersion.findUnique({
      where: { noteId_version: { noteId: noteRecord.id, version: 17 } },
    });
    if (!v17 || v17.kind !== 'S') throw new Error(`Expected v17 to be Keyframe due to large churn, got ${v17?.kind}`);
    console.log('✓ Test 11 passed: Large content churn correctly triggered Keyframe fallback');

    // Test 12: Cascade delete on Project deletion
    await basePrisma.project.delete({ where: { id: projectId } });
    const remainingNotes = await basePrisma.projectNote.findUnique({ where: { projectId } });
    const remainingVersions = await basePrisma.projectNoteVersion.findMany({ where: { noteId: noteRecord.id } });
    if (remainingNotes !== null || remainingVersions.length !== 0) {
      throw new Error('Expected cascade delete of ProjectNote and ProjectNoteVersion');
    }
    console.log('✓ Test 10 passed: Cascade deletion of Project cleaned up all Note and Version rows');

    console.log('============================================');
    console.log('🎉 ALL 10 TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('============================================');
  } catch (err) {
    console.error('❌ Test failed:', err);
    // Cleanup if project still exists
    try {
      await basePrisma.project.delete({ where: { id: projectId } });
    } catch {}
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runTests();
