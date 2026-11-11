import type { ReactNode } from 'react'

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
  /** The button a TV's remote opens the page on, once. */
  isOpener?: boolean
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

/** Settings' pieces, which each platform lays out and drives its own way. */
export type SettingsKit = {
  SettingsPage: (props: SettingsPageProps) => ReactNode
  SettingsSection: (props: SettingsSectionProps) => ReactNode
  SettingsToggle: (props: SettingsToggleProps) => ReactNode
  SettingsButton: (props: SettingsButtonProps) => ReactNode
  SettingsLine: (props: SettingsLineProps) => ReactNode
  SettingsFact: (props: SettingsFactProps) => ReactNode
  SettingsChoice: <K extends string>(props: SettingsChoiceProps<K>) => ReactNode
}
