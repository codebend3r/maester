import type { RouteObject } from 'react-router-dom'
import { HomePage } from '@/renderer/HomePage/HomePage'
import { Shell } from '@/renderer/Shell/Shell'

export const desktopRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    children: [{ index: true, element: <HomePage /> }],
  },
]
