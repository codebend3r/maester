export const SECTION_IDS = {
  logo: 'logo',
  colour: 'colour',
  tokens: 'tokens',
  text: 'text',
  forms: 'forms',
  content: 'content',
  components: 'components',
} as const

/** The design page's sections in order: the contents bar and each section's number read this. */
export const SECTIONS = [
  { id: SECTION_IDS.logo, title: 'Logo' },
  { id: SECTION_IDS.colour, title: 'Colour' },
  { id: SECTION_IDS.tokens, title: 'Tokens' },
  { id: SECTION_IDS.text, title: 'Text' },
  { id: SECTION_IDS.forms, title: 'Forms' },
  { id: SECTION_IDS.content, title: 'Content' },
  { id: SECTION_IDS.components, title: 'Components' },
] as const satisfies ReadonlyArray<{ id: string; title: string }>

export type SectionId = (typeof SECTIONS)[number]['id']

/** A section's place on the page, two digits: 01 for the first. */
export const sectionNumber = (id: SectionId): string =>
  String(SECTIONS.findIndex((section) => section.id === id) + 1).padStart(2, '0')

/** A section's title, as the contents bar and its heading both show it. */
export const sectionTitle = (id: SectionId): string =>
  SECTIONS.find((section) => section.id === id)?.title ?? id
