import { CAPTION_COLOURS, CAPTION_SIZES, type CaptionColour, type CaptionSize } from '@raven/core'
import { CAPTION_COLOUR_NAMES, CAPTION_SIZE_NAMES, useCaptionStyle } from '@raven/ui/headless'
import { useId } from 'react'
import { api } from '@/lib/api'
import { type Choices, Setting } from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

const COPY = SETTINGS_COPY.captions

const SIZES: Choices<CaptionSize> = {
  [CAPTION_SIZES.small]: { label: CAPTION_SIZE_NAMES.small, hint: COPY.sizeHints.small },
  [CAPTION_SIZES.medium]: { label: CAPTION_SIZE_NAMES.medium, hint: COPY.sizeHints.medium },
  [CAPTION_SIZES.large]: { label: CAPTION_SIZE_NAMES.large, hint: COPY.sizeHints.large },
  [CAPTION_SIZES.largest]: { label: CAPTION_SIZE_NAMES.largest, hint: COPY.sizeHints.largest },
}

const COLOURS: Choices<CaptionColour> = {
  [CAPTION_COLOURS.white]: { label: CAPTION_COLOUR_NAMES.white, hint: COPY.colourHints.white },
  [CAPTION_COLOURS.yellow]: { label: CAPTION_COLOUR_NAMES.yellow, hint: COPY.colourHints.yellow },
  [CAPTION_COLOURS.cyan]: { label: CAPTION_COLOUR_NAMES.cyan, hint: COPY.colourHints.cyan },
  [CAPTION_COLOURS.green]: { label: CAPTION_COLOUR_NAMES.green, hint: COPY.colourHints.green },
}

/**
 * How subtitles look for the account: one size and one colour for every video, kept on the
 * server so every device it signs in on draws them the same. A pick saves at once.
 */
export const CaptionSettings = () => {
  const headingId = useId()
  const { style, change } = useCaptionStyle(api)
  return (
    <section className={styles.settings} aria-labelledby={headingId}>
      <header className={styles.setting}>
        <h3 id={headingId} className={styles.subheading}>
          <Titled icon="captions">{COPY.heading}</Titled>
        </h3>
        <p className={styles.hint}>{COPY.help}</p>
      </header>
      <Setting
        icon="resize"
        label={COPY.size}
        values={Object.values(CAPTION_SIZES)}
        choices={SIZES}
        value={style.size}
        onChange={(size) => change({ size })}
      />
      <Setting
        icon="sun"
        label={COPY.colour}
        values={Object.values(CAPTION_COLOURS)}
        choices={COLOURS}
        value={style.colour}
        onChange={(colour) => change({ colour })}
      />
    </section>
  )
}
