/** The design page's sections in order: the contents bar and each section's number read this. */
export const SECTIONS = [
  { id: 'logo', title: 'Logo' },
  { id: 'colour', title: 'Colour' },
  { id: 'tokens', title: 'Tokens' },
  { id: 'text', title: 'Text' },
  { id: 'forms', title: 'Forms' },
  { id: 'content', title: 'Content' },
  { id: 'components', title: 'Components' },
] as const satisfies ReadonlyArray<{ id: string; title: string }>

export type SectionId = (typeof SECTIONS)[number]['id']

/** A section's place on the page, two digits: 01 for the first. */
export const sectionNumber = (id: SectionId): string =>
  String(SECTIONS.findIndex((section) => section.id === id) + 1).padStart(2, '0')

/** A section's title, as the contents bar and its heading both show it. */
export const sectionTitle = (id: SectionId): string =>
  SECTIONS.find((section) => section.id === id)?.title ?? id
