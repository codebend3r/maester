import type { RouteObject } from 'react-router-dom'
import { HomePage } from '@/renderer/HomePage/HomePage'
import { PlayRoute } from '@/renderer/PlayPage/PlayPage'
import { SettingsPage } from '@/renderer/SettingsPage/SettingsPage'
import { Shell } from '@/renderer/Shell/Shell'

export const desktopRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'play/:fileId', element: <PlayRoute /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]
