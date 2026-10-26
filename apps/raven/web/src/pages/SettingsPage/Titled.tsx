import { Icon, type IconName } from '@raven/ui'

type TitledProps = { icon: IconName; children: string }

/** A setting's or a section's title with its icon before it. */
export const Titled = ({ icon, children }: TitledProps) => (
  <>
    <Icon name={icon} />
    {children}
  </>
)
