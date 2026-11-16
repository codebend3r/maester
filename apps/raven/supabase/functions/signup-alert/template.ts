/** raven's colours, from `libs/raven/ui/src/styles/globals.scss`; an email client reads no stylesheet, so they are written out. */
const MAIL_COLOURS = {
  night: '#15201e',
  canopy: '#1c2b28',
  moss: '#2c3e3a',
  bark: '#e6e1d6',
  lichen: '#9db0a8',
  leaf: '#a8262f',
  onLeaf: '#ffffff',
} as const

/** The faces, closest to raven's Young Serif and Instrument Sans that every mail client has. */
const MAIL_FONTS = {
  display: "Georgia, 'Times New Roman', serif",
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
} as const

const isEscaped = (character: string): character is keyof typeof HTML_ESCAPES =>
  character in HTML_ESCAPES

/** Text made safe to sit in HTML: an address someone typed must never become markup. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) =>
    isEscaped(character) ? HTML_ESCAPES[character] : character,
  )

/** One email's words: its heading, its paragraphs and the one button it leads to. */
export type MailPage = {
  heading: string
  paragraphs: readonly string[]
  action: { label: string; url: string }
}

/**
 * An email as raven's pages look: the wordmark and a card on the night ground, the heading in a
 * serif, the paragraphs, and one button in raven's red, with the link spelled out under it for a
 * client that draws no buttons. Tables and inline styles only, since mail clients read nothing
 * else. Every word is escaped.
 */
export const mailHtml = ({ heading, paragraphs, action }: MailPage): string => {
  const url = escapeHtml(action.url)
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:${MAIL_COLOURS.bark};font-family:${MAIL_FONTS.body};font-size:16px;line-height:1.6;">${escapeHtml(paragraph)}</p>`,
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${MAIL_COLOURS.night};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MAIL_COLOURS.night};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 0 16px;color:${MAIL_COLOURS.bark};font-family:${MAIL_FONTS.display};font-size:24px;">raven</td></tr>
<tr><td style="padding:32px;background:${MAIL_COLOURS.canopy};border:1px solid ${MAIL_COLOURS.moss};border-radius:12px;">
<h1 style="margin:0 0 16px;color:${MAIL_COLOURS.bark};font-family:${MAIL_FONTS.display};font-size:26px;font-weight:normal;line-height:1.3;">${escapeHtml(heading)}</h1>
${body}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="background:${MAIL_COLOURS.leaf};border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:12px 24px;color:${MAIL_COLOURS.onLeaf};font-family:${MAIL_FONTS.body};font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(action.label)}</a>
</td></tr></table>
<p style="margin:0;color:${MAIL_COLOURS.lichen};font-family:${MAIL_FONTS.body};font-size:13px;line-height:1.5;">Or open <a href="${url}" style="color:${MAIL_COLOURS.lichen};">${url}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
