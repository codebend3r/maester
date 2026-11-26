import { type ComponentType, useState } from 'react'

import { FocusButton } from '@/ui/FocusButton'
import { FOCUS_ROLES } from '@/ui/Focusable'
import { ListRow } from '@/ui/ListRow'
import { Sheet } from '@/ui/Sheet'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon'

/** One of the choices offered, as it is kept and as it is called, with a quiet line under it. */
type ChoiceOption<Choice extends string> = { value: Choice; label: string; line?: string }

/** How the choice in use shows: a pill among a list's tools, or a row of a group of settings. */
export const CHOICE_LOOKS = { button: 'button', row: 'row' } as const

type ChoiceLook = (typeof CHOICE_LOOKS)[keyof typeof CHOICE_LOOKS]

type TriggerProps = {
  title: string
  icon: WrenIconName
  /** The choice in use's word. */
  chosenLabel: string
  /** What the pill is called aloud, from the choice in use's word: "Sort by, Title". */
  spokenLabel: string
  onOpen: () => void
}

/** A pill showing the choice in use: a list's sort or cover size. */
function ButtonTrigger({ icon, chosenLabel, spokenLabel, onOpen }: TriggerProps) {
  return <FocusButton icon={icon} label={spokenLabel} onPress={onOpen} text={chosenLabel} />
}

/** A row named for what it chooses, the choice in use at its end: Appearance's theme. */
function RowTrigger({ title, icon, chosenLabel, onOpen }: TriggerProps) {
  return <ListRow icon={icon} onPress={onOpen} canOpen title={title} value={chosenLabel} />
}

type OptionProps<Choice extends string> = {
  option: ChoiceOption<Choice>
  isChosen: boolean
  icon: WrenIconName
  onChoose: (choice: Choice) => void
}

function ButtonOption<Choice extends string>({ option, isChosen, onChoose }: OptionProps<Choice>) {
  return (
    <FocusButton
      hasPreferredFocus={isChosen}
      isSelected={isChosen}
      label={option.label}
      onPress={() => onChoose(option.value)}
      role={FOCUS_ROLES.radio}
      text={option.label}
    />
  )
}

function RowOption<Choice extends string>({
  option,
  isChosen,
  icon,
  onChoose,
}: OptionProps<Choice>) {
  return (
    <ListRow
      hasPreferredFocus={isChosen}
      icon={isChosen ? ICONS.check : icon}
      isSelected={isChosen}
      line={option.line ?? null}
      onPress={() => onChoose(option.value)}
      role={FOCUS_ROLES.radio}
      title={option.label}
    />
  )
}

const TRIGGERS = {
  [CHOICE_LOOKS.button]: ButtonTrigger,
  [CHOICE_LOOKS.row]: RowTrigger,
} as const satisfies Record<ChoiceLook, ComponentType<TriggerProps>>

const OPTIONS = {
  [CHOICE_LOOKS.button]: ButtonOption,
  [CHOICE_LOOKS.row]: RowOption,
} as const satisfies Record<ChoiceLook, ComponentType<OptionProps<string>>>

/** A pill said aloud as its choice's word, where nothing names it more. */
const asSaid = (label: string): string => label

type ChoiceButtonProps<Choice extends string> = {
  /** What it chooses: the sheet's title, and a row's name. */
  title: string
  icon: WrenIconName
  /** A pill's spoken name, from the choice in use's word; a row reads its name and value. */
  spokenLabelOf?: (label: string) => string
  options: readonly ChoiceOption<Choice>[]
  chosen: Choice
  onChoose: (choice: Choice) => void
  look?: ChoiceLook
}

/**
 * A choice in use (a list's sort, its cover size, the theme worn), showing the choice's word. A
 * press opens a sheet of the choices, the one in use picked and the remote on it; a choice closes it.
 */
export function ChoiceButton<Choice extends string>({
  title,
  icon,
  spokenLabelOf = asSaid,
  options,
  chosen,
  onChoose,
  look = CHOICE_LOOKS.button,
}: ChoiceButtonProps<Choice>) {
  const [isOpen, setIsOpen] = useState(false)
  const chosenLabel = options.find(({ value }) => value === chosen)?.label ?? ''
  const Trigger = TRIGGERS[look]
  const Option: ComponentType<OptionProps<Choice>> = OPTIONS[look]
  const choose = (next: Choice) => {
    onChoose(next)
    setIsOpen(false)
  }
  return (
    <>
      <Trigger
        chosenLabel={chosenLabel}
        icon={icon}
        onOpen={() => setIsOpen(true)}
        spokenLabel={spokenLabelOf(chosenLabel)}
        title={title}
      />
      <Sheet isOpen={isOpen} onClose={() => setIsOpen(false)} title={title}>
        {options.map((option) => (
          <Option
            icon={icon}
            isChosen={option.value === chosen}
            key={option.value}
            onChoose={choose}
            option={option}
          />
        ))}
      </Sheet>
    </>
  )
}
