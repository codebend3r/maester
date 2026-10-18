import { Icon, type IconName } from '@raven/ui'

/** A setting's or a section's title with its icon before it. */
export const Titled = ({ icon, children }: { icon: IconName; children: string }) => (
  <>
    <Icon name={icon} />
    {children}
  </>
)
