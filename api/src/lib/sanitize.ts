import sanitizeHtml from 'sanitize-html';

const opts: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'h1',
    'h2',
    'span',
    'div',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'hr',
    'br',
    'p',
    'a',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'pre',
    'code',
    'blockquote',
    'center',
    'font',
  ]),
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['style', 'class', 'align', 'valign', 'bgcolor', 'color', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, opts);
}

export function previewText(text: string, n = 120): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}
