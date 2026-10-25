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

export type SettingsButtonProps = { text: string; isDisabled: boolean; onPress: () => void }

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
  SettingsChoice: <K extends string>(props: SettingsChoiceProps<K>) => ReactNode
}
