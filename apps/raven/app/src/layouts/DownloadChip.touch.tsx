import type { DownloadButton } from '@/downloads/downloadControl'
import { Chip } from '@/layouts/Chip.touch'

/** A music page's Download: its words, filled once all of it is on the device, faint while a group comes in. */
export const DownloadChip = ({ control, onPress }: DownloadButton) => (
  <Chip
    icon={control.icon}
    isDisabled={control.isDisabled}
    isOn={control.isOn}
    label={control.label}
    onPress={onPress}
    text={control.text}
  />
)
