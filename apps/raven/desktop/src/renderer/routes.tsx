import type { RouteObject } from 'react-router-dom'
import { DownloadsPage } from '@/renderer/DownloadsPage/DownloadsPage'
import { HomePage } from '@/renderer/HomePage/HomePage'
import { PlayRoute } from '@/renderer/PlayPage/PlayPage'
import { ServerRoute } from '@/renderer/ServerPage/ServerPage'
import { SettingsPage } from '@/renderer/SettingsPage/SettingsPage'
import { Shell } from '@/renderer/Shell/Shell'

export const desktopRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'play/:fileId', element: <PlayRoute /> },
      { path: 'server/:serverId/:mediaId', element: <ServerRoute /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'downloads', element: <DownloadsPage /> },
    ],
  },
]
