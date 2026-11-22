import { COVER_SIZES, type CoverSize, LIBRARY_PAGE_COPY } from '@raven/wren'

import { ChoiceButton } from '@/screens/library/ChoiceButton'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { ICONS } from '@/ui/WrenIcon'

/** The five cover sizes, smallest first, each in its word. */
const COVER_SIZE_OPTIONS = Object.values(COVER_SIZES).map((size) => ({
  value: size,
  label: LIBRARY_PAGE_COPY.coverSizes[size],
}))

/** How large Albums draws its covers, kept in the prefs; a press opens a sheet of the five sizes. */
export function CoverSizeButton() {
  const coverSize = useWrenPrefs((state) => state.coverSize)
  const change = useWrenPrefs((state) => state.change)
  return (
    <ChoiceButton
      chosen={coverSize}
      icon={ICONS.grid}
      onChoose={(size: CoverSize) => change({ coverSize: size })}
      options={COVER_SIZE_OPTIONS}
      spokenLabelOf={LIBRARY_PAGE_COPY.coverSizeLabel}
      title={LIBRARY_PAGE_COPY.coverSize}
    />
  )
}
