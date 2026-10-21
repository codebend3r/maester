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

/** One of a row's buttons: `text` is what it shows, `label` what it is called aloud. */
export type SettingsAction = { key: string; text: string; label: string; onPress: () => void }

export type ServerRowProps = {
  name: string
  /** The server's address, under its name. */
  line: string
  /** What marks the server in use, or null for any other. */
  badge: string | null
  actions: readonly SettingsAction[]
  /**
   * The key of the button the remote opens on, on a TV, or null for none in this row: the first
   * row's first, or the Rename the viewer came back from.
   */
  openingAction: string | null
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

export type SettingsSheetProps = {
  /** Called when the viewer backs out of the sheet: Menu or Back on a TV. */
  onClose: () => void
  children: ReactNode
}

/** Settings' pieces, which each platform lays out and drives its own way. */
export type SettingsKit = {
  SettingsPage: (props: SettingsPageProps) => ReactNode
  SettingsSection: (props: SettingsSectionProps) => ReactNode
  ServerRow: (props: ServerRowProps) => ReactNode
  SettingsToggle: (props: SettingsToggleProps) => ReactNode
  SettingsButton: (props: SettingsButtonProps) => ReactNode
  SettingsChoice: <K extends string>(props: SettingsChoiceProps<K>) => ReactNode
  /** What a step drawn over Settings, a rename, sits in, so backing out of it stays on Settings. */
  SettingsSheet: (props: SettingsSheetProps) => ReactNode
}
