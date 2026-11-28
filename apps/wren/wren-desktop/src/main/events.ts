/** The Electron events main listens for, which the end to end suite listens for beside it. */
export const EVENTS = {
  activate: 'activate',
  beforeQuit: 'before-quit',
  close: 'close',
  moved: 'moved',
  readyToShow: 'ready-to-show',
  resize: 'resize',
  secondInstance: 'second-instance',
  webContentsCreated: 'web-contents-created',
  willAttachWebview: 'will-attach-webview',
  willNavigate: 'will-navigate',
  willRedirect: 'will-redirect',
  windowAllClosed: 'window-all-closed',
} as const
