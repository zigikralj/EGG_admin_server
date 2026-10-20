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
  const projects = await basePrisma.project.findMany({
    where: {
      OR: [
        { notes: { contains: '<!--[if' } },
        { notes: { contains: '<xml' } },
        { notes: { contains: 'Style Definitions' } },
        { notes: { contains: 'SR-LATN-RS' } },
      ],
    },
    select: { id: true, name: true, notes: true },
  });

  console.log(`Found ${projects.length} projects with Word/Office metadata.`);
  let cleanedCount = 0;

  for (const p of projects) {
    if (!p.notes) continue;
    const cleaned = cleanWordHtml(p.notes);
    if (cleaned !== p.notes) {
      await basePrisma.project.update({
        where: { id: p.id },
        data: { notes: cleaned || null },
      });
      cleanedCount++;
      console.log(`✓ Cleaned [${p.id}] ${p.name} (${p.notes.length} bytes -> ${cleaned.length} bytes)`);
    }
  }

  console.log(`Successfully cleaned ${cleanedCount} projects.`);
}

if (process.argv[1]?.endsWith('cleanWordNotes.ts')) {
  main()
    .catch(console.error)
    .finally(() => process.exit(0));
}
