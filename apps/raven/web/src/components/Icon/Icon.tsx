export type IconName =
  | 'back'
  | 'plus'
  | 'rescan'
  | 'edit'
  | 'close'
  | 'folder'
  | 'up'
  | 'alert'
  | 'copy'
  | 'search'
  | 'trash'
  | 'more'
  | 'heart'

const PATHS: Record<IconName, string> = {
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  rescan: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  close: 'M6 6l12 12M18 6L6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  up: 'M12 19V5M5 12l7-7 7 7',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  more: 'M12 5.5v.5M12 12v.5M12 18.5v.5',
  heart: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 5.7-8 11-8 11z',
}

/** Line icons. Decorative by default: pair them with text or an aria-label on the control. */
export const Icon = ({ name, size = 20 }: { name: IconName; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={PATHS[name]} />
  </svg>
)
