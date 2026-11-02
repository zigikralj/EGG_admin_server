import sanitizeHtml from 'sanitize-html';

/**
 * Strips Microsoft Word and Office specific metadata, XML blocks, conditional comments,
 * and style tags to prevent raw XML and style definitions from polluting notes.
 * Uses a robust HTML parser (sanitize-html) rather than vulnerable regexes.
 */
export function cleanWordHtml(html?: string | null): string {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'u', 's', 'strike', 'sub', 'sup', 'hr'
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'data-*'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowedStyles: {
      '*': {
        'color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i, /^[a-z]+$/i],
        'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i, /^[a-z]+$/i],
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'font-weight': [/^(bold|normal|[1-9]00)$/],
        'font-style': [/^(italic|normal)$/],
        'text-decoration': [/^(underline|line-through|none)$/],
        'width': [/^\d+(?:px|%|em|rem)$/],
        'min-width': [/^\d+(?:px|%|em|rem)$/],
        'max-width': [/^\d+(?:px|%|em|rem)$/],
      },
    },
  }).trim();
}

/**
 * Safely converts HTML content to plain text.
 * Strips scripts, styles, comments, XML blocks, and all HTML tags,
 * and normalizes whitespace and line breaks.
 */
export function stripHtmlToText(html?: string | null): string {
  if (!html) return '';
  // Sanitize via parser to strip scripts, styles, comments, and XML safely
  const safe = sanitizeHtml(html, {
    allowedTags: ['br', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr'],
    allowedAttributes: {},
  });
  return safe
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u00a0\u200B\uFEFF]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Extracts a truncated plain-text preview (up to 300 chars) from HTML notes.
 */
export function extractNotesPreview(notes?: string | null): string | null {
  if (!notes) return null;
  const plainText = stripHtmlToText(notes).replace(/\s+/g, ' ').trim();
  if (!plainText) return null;
  return plainText.length > 300 ? plainText.slice(0, 300) : plainText;
}
