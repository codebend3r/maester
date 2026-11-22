import { DESIGN_COPY } from '@raven/wren'
import { WrenLockup, WrenMark } from '@/components/WrenLockup/WrenLockup'
import { DesignSection, Specimen } from '@/screens/Design/DesignSection'
import { SECTION_IDS } from '@/screens/Design/sections'
import { SIZES } from '@/theme/tokens'

const COPY = DESIGN_COPY.logo

/** The logo, in the ink of the theme worn. */
export function LogoSection() {
  return (
    <DesignSection id={SECTION_IDS.logo} intro={COPY.intro}>
      <Specimen name={COPY.lockup} note={COPY.lockupNote}>
        <WrenLockup size={SIZES.signInLockup} />
      </Specimen>
      <Specimen name={COPY.mark} note={COPY.markNote}>
        <WrenMark size={SIZES.signInMark} />
      </Specimen>
    </DesignSection>
  )
}
