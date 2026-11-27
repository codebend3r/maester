import { COVER_SIZE_OPTIONS, type CoverSize, LIBRARY_PAGE_COPY, WREN_ICONS } from '@raven/wren'

import { ChoiceButton } from '@/screens/library/ChoiceButton'
import { useWrenPrefs } from '@/stores/wrenPrefs'

/** How large Albums draws its covers, kept in the prefs; a press opens a sheet of the five sizes. */
export function CoverSizeButton() {
  const coverSize = useWrenPrefs((state) => state.coverSize)
  const change = useWrenPrefs((state) => state.change)
  return (
    <ChoiceButton
      chosen={coverSize}
      icon={WREN_ICONS.grid}
      onChoose={(size: CoverSize) => change({ coverSize: size })}
      options={COVER_SIZE_OPTIONS}
      spokenLabelOf={LIBRARY_PAGE_COPY.coverSizeLabel}
      title={LIBRARY_PAGE_COPY.coverSize}
    />
  )
}
