import type { TabEntry } from '@raven/ui/headless'
import type { ReactNode } from 'react'

import { SETTINGS_TABS_COPY } from '@/layouts/copy'
import type { PickerProps } from '@/layouts/gridKit'

export type SettingsPageProps = {
  title: string
  onBack: () => void
  children: ReactNode
}

export type SettingsSectionProps = {
  title: string
  /** A line under the section's controls, saying what they do or why one is off. */
  note: string | null
  children: ReactNode
}

export type SettingsToggleProps = {
  label: string
  /** What the setting does, under its label. */
  hint: string
  isOn: boolean
  onToggle: (isOn: boolean) => void
}

export type SettingsButtonProps = {
  text: string
  isDisabled: boolean
  onPress: () => void
  /** What a screen reader calls it, when the text alone is the same on several: "Quick scan Films". */
  name?: string
}

/** A line of its own between the controls: a status, a fact or why something failed. */
export type SettingsLineProps = {
  text: string
  /** Read out the moment it shows, as something gone wrong is. */
  isAlert?: boolean
}

/** A fact read, not set, here: its name at the start and its value at the end. */
export type SettingsFactProps = {
  label: string
  value: string
  /** Sets the value in the fixed-width face, as an address or a port is read. */
  isCode?: boolean
}

/** A setting picked from a list: its row shows the label and what is chosen now. */
export type SettingsChoiceProps<K extends string> = Pick<
  PickerProps<K>,
  'label' | 'options' | 'value' | 'onChoose'
>

type TabA11yOfProps<T extends string> = { tab: TabEntry<T>; isChosen: boolean }

/** How a screen reader hears one of Settings' tabs, the same on a phone and a TV. */
export const tabA11yOf = <T extends string>({ tab, isChosen }: TabA11yOfProps<T>) =>
  ({
    accessibilityLabel: SETTINGS_TABS_COPY.name(tab),
    accessibilityRole: 'tab',
    accessibilityState: { selected: isChosen },
  }) as const

/**
 * Settings' tabs, the web's, each a group of related settings, drawn under the title over the
 * chosen tab's settings. A TV's remote opens the page on the chosen tab, once.
 */
export type SettingsTabsProps<T extends string> = {
  label: string
  tabs: readonly TabEntry<T>[]
  chosen: T
  onChoose: (value: T) => void
}

/** Settings' pieces, which each platform lays out and drives its own way. */
export type SettingsKit = {
  SettingsPage: (props: SettingsPageProps) => ReactNode
  SettingsSection: (props: SettingsSectionProps) => ReactNode
  SettingsToggle: (props: SettingsToggleProps) => ReactNode
  SettingsButton: (props: SettingsButtonProps) => ReactNode
  SettingsLine: (props: SettingsLineProps) => ReactNode
  SettingsFact: (props: SettingsFactProps) => ReactNode
  SettingsChoice: <K extends string>(props: SettingsChoiceProps<K>) => ReactNode
  SettingsTabs: <T extends string>(props: SettingsTabsProps<T>) => ReactNode
}
