import { basePrisma } from './db';
import { cleanWordHtml } from './helpers/htmlUtils';

export { cleanWordHtml };

async function main() {
  const notes = await basePrisma.projectNote.findMany({
    where: {
      OR: [
        { content: { contains: '<!--[if' } },
        { content: { contains: '<xml' } },
        { content: { contains: 'Style Definitions' } },
        { content: { contains: 'SR-LATN-RS' } },
      ],
    },
    select: { id: true, projectId: true, content: true },
  });

  console.log(`Found ${notes.length} project notes with Word/Office metadata.`);
  let cleanedCount = 0;

  for (const n of notes) {
    if (!n.content) continue;
    const cleaned = cleanWordHtml(n.content);
    if (cleaned !== n.content) {
      await basePrisma.projectNote.update({
        where: { id: n.id },
        data: { content: cleaned || null },
      });
      cleanedCount++;
      console.log(`✓ Cleaned [${n.id}] Project [${n.projectId}] (${n.content.length} bytes -> ${cleaned.length} bytes)`);
    }
  }

  console.log(`Successfully cleaned ${cleanedCount} project notes.`);
}

if (process.argv[1]?.endsWith('cleanWordNotes.ts')) {
  main()
    .catch(console.error)
    .finally(() => process.exit(0));
}
