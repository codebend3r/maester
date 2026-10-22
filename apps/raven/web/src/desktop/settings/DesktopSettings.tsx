import { DownloadsSection } from '@/desktop/settings/DownloadsSection'
import { ThisComputerSection } from '@/desktop/settings/ThisComputerSection'
import { UpdatesSection } from '@/desktop/settings/UpdatesSection'

/** raven player's own settings, which Settings shows only inside the app. */
export const DesktopSettings = () => (
  <>
    <DownloadsSection />
    <ThisComputerSection />
    <UpdatesSection />
  </>
)
