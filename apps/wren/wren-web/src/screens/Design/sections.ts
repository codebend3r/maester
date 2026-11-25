import { DESIGN_COPY } from '@raven/wren'

/** The design page's sections, by the id each one's anchor and its title in `DESIGN_COPY` go by. */
export const SECTION_IDS = {
  logo: 'logo',
  colour: 'colour',
  tokens: 'tokens',
  text: 'text',
  components: 'components',
} as const

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS]

/** The sections in the order the page draws them: the contents bar and each section's number read this. */
export const SECTIONS = Object.values(SECTION_IDS)

type SectionIdProps = { id: SectionId }

/** A section's place on the page, two digits: 01 for the first. */
export const sectionNumber = ({ id }: SectionIdProps): string =>
  String(SECTIONS.indexOf(id) + 1).padStart(2, '0')

/** A section's title, as the contents bar and its heading both show it. */
export const sectionTitle = ({ id }: SectionIdProps): string => DESIGN_COPY.sections[id]
