import { basePrisma } from './db';

/**
 * Strips Microsoft Word and Office specific metadata, XML blocks, conditional comments,
 * and style tags to prevent raw XML and style definitions from polluting notes.
 */
export function cleanWordHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(meta|link|title)[\s\S]*?\/?>/gi, '')
    .trim();
}

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
