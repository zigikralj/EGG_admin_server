import { basePrisma, prisma } from '../db';
import { parseSince, fetchDeletedIds, buildDeltaResponse } from './deltaSync';
import { requestContext } from '../context';

async function runTests() {
  console.log('--- Starting Delta Sync Unit & Integration Tests ---');

  // Test 1: parseSince validation
  console.log('\n[Test 1] parseSince');
  if (parseSince(undefined) !== null) throw new Error('Expected undefined to return null');
  if (parseSince(null) !== null) throw new Error('Expected null to return null');
  if (parseSince('') !== null) throw new Error('Expected empty string to return null');
  if (parseSince('invalid-date') !== null) throw new Error('Expected invalid-date to return null');

  const iso = '2026-10-22T00:00:00.000Z';
  const parsed = parseSince(iso);
  if (!parsed || parsed.toISOString() !== iso) throw new Error('Failed to parse valid ISO string');
  console.log('✓ parseSince passes all unit tests');

  // Test 2: buildDeltaResponse format
  console.log('\n[Test 2] buildDeltaResponse');
  const items = [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }];
  const deletedIds = ['3'];

  // Backward-compatible mode (sinceDate is null)
  const legacy = buildDeltaResponse(items, deletedIds, null);
  if (!Array.isArray(legacy) || legacy.length !== 2) throw new Error('Expected legacy array response when since is null');

  // Delta mode (sinceDate is provided)
  const delta = buildDeltaResponse(items, deletedIds, parsed);
  if (Array.isArray(delta)) throw new Error('Expected envelope response when since is present');
  if (!delta.delta || delta.items.length !== 2 || delta.deletedIds[0] !== '3' || !delta.syncedAt) {
    throw new Error('Delta envelope fields mismatch');
  }
  console.log('✓ buildDeltaResponse passes envelope and backwards-compatibility tests');

  // Test 3: fetchDeletedIds & EntityVersion tombstone tracking
  console.log('\n[Test 3] fetchDeletedIds with EntityVersion tombstones');
  await requestContext.run({ userId: 'test-user', userName: 'Test User' }, async () => {
    const beforeCreate = new Date(Date.now() - 1000);

    // Create a temporary project
    const tempProject = await prisma.project.create({
      data: {
        name: 'Temp Project for Delta Deletion ' + Date.now(),
        clientName: 'Temp Client',
        type: 'Otpad',
      },
    });

    const createdId = tempProject.id;
    console.log('Created project for deletion test:', createdId);

    // Delete the project (audited transaction creates EntityVersion with op: 'D')
    await prisma.project.delete({
      where: { id: createdId },
    });
    console.log('Deleted project:', createdId);

    // Fetch deleted IDs since before creation
    const tombstonedIds = await fetchDeletedIds('Project', beforeCreate);
    console.log('Retrieved tombstone IDs:', tombstonedIds);

    if (!tombstonedIds.includes(createdId)) {
      throw new Error(`Expected deleted project ID ${createdId} to be in tombstones list`);
    }
    console.log('✓ fetchDeletedIds successfully retrieved tombstone from EntityVersion');
  });

  // Test 4: Query filtering with updatedAt > since
  console.log('\n[Test 4] Query filtering with updatedAt');
  const projectA = await prisma.project.create({
    data: {
      name: 'Delta Query Test A ' + Date.now(),
      clientName: 'Client A',
      type: 'Otpad',
    },
  });

  // Wait 50ms so timestamp advances
  await new Promise((r) => setTimeout(r, 100));
  const checkpoint = new Date();
  await new Promise((r) => setTimeout(r, 100));

  // Create Project B after checkpoint
  const projectB = await prisma.project.create({
    data: {
      name: 'Delta Query Test B ' + Date.now(),
      clientName: 'Client B',
      type: 'Otpad',
    },
  });

  // Query projects updated after checkpoint
  const deltaProjects = await prisma.project.findMany({
    where: {
      id: { in: [projectA.id, projectB.id] },
      updatedAt: { gt: checkpoint },
    },
  });

  console.log('Projects after checkpoint:', deltaProjects.map((p) => p.name));
  if (deltaProjects.length !== 1 || deltaProjects[0].id !== projectB.id) {
    throw new Error(`Expected only Project B to be returned after checkpoint, got ${deltaProjects.length}`);
  }
  console.log('✓ SQL-level updatedAt filtering returned only updated records');

  // Cleanup test projects
  await prisma.project.deleteMany({
    where: { id: { in: [projectA.id, projectB.id] } },
  });

  console.log('\n========================================');
  console.log('ALL DELTA SYNC TESTS PASSED SUCCESSFULLY');
  console.log('========================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
