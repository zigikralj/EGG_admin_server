import http from 'http';
import { createApp } from '../app';
import { prisma, basePrisma } from '../db';
import { generateToken } from '../authUtils';

async function runEndpointTests() {
  console.log('--- Starting Express Route Delta Integration Tests ---');

  // 1. Get or create an admin user for auth headers
  let admin = await basePrisma.user.findFirst({
    where: { role: 'Administrator' },
  });
  if (!admin) {
    admin = await basePrisma.user.create({
      data: {
        name: 'Admin Test User',
        email: 'admintest@ekos.rs',
        role: 'Administrator',
      },
    });
  }

  const token = generateToken({
    id: admin.id,
    role: admin.role,
  });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'X-User-Id': admin.id,
    'Content-Type': 'application/json',
  };

  // 2. Start test server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://localhost:${address.port}`;
  console.log('Test server listening at:', baseUrl);

  try {
    const endpoints = [
      { name: 'Projects', path: '/api/projects' },
      { name: 'Invoices', path: '/api/invoices' },
      { name: 'Clients', path: '/api/clients' },
      { name: 'Permits', path: '/api/permits' },
      { name: 'Reminders', path: '/api/reminders' },
      { name: 'ProvidedServices', path: '/api/provided-services' },
    ];

    for (const ep of endpoints) {
      console.log(`\nTesting endpoint: ${ep.name} (${ep.path})`);

      // Test A: Normal request without ?since -> must return standard Array
      const resLegacy = await fetch(`${baseUrl}${ep.path}`, { headers });
      if (!resLegacy.ok) {
        throw new Error(`${ep.name} legacy fetch failed: HTTP ${resLegacy.status}`);
      }
      const dataLegacy = await resLegacy.json();
      if (!Array.isArray(dataLegacy)) {
        throw new Error(`${ep.name} expected Array for legacy request, got: ${typeof dataLegacy}`);
      }
      console.log(`  ✓ Legacy request returned Array (count: ${dataLegacy.length})`);

      // Test B: Request with ?since -> must return DeltaEnvelope
      const nowIso = new Date().toISOString();
      const resDelta = await fetch(`${baseUrl}${ep.path}?since=${encodeURIComponent(nowIso)}`, { headers });
      if (!resDelta.ok) {
        throw new Error(`${ep.name} delta fetch failed: HTTP ${resDelta.status}`);
      }
      const dataDelta = await resDelta.json();
      if (Array.isArray(dataDelta)) {
        throw new Error(`${ep.name} expected DeltaEnvelope, but got Array`);
      }
      if (dataDelta.delta !== true) {
        throw new Error(`${ep.name} expected delta: true`);
      }
      if (!Array.isArray(dataDelta.items) || !Array.isArray(dataDelta.deletedIds)) {
        throw new Error(`${ep.name} expected items and deletedIds arrays`);
      }
      if (!dataDelta.syncedAt) {
        throw new Error(`${ep.name} missing syncedAt timestamp`);
      }
      console.log(`  ✓ Delta request returned DeltaEnvelope (delta: ${dataDelta.delta}, items: ${dataDelta.items.length}, deleted: ${dataDelta.deletedIds.length}, syncedAt: ${dataDelta.syncedAt})`);
    }

    console.log('\n======================================================');
    console.log('ALL 6 ENDPOINTS PASSED DELTA & BACKWARD COMPATIBILITY');
    console.log('======================================================\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runEndpointTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Endpoint test failure:', err);
    process.exit(1);
  });
