type ProgressProps = { position: string; duration: string }

type WatcherProps = { viewer: string; device: string }

type ClientProps = { device: string; browser: string }

type StopStreamProps = { title: string; device: string; browser: string }

type StopDownloadProps = { title: string; device: string }

type DetailsToggleProps = { isOpen: boolean; title: string }

type ReceivedProps = { received: string; size: string }

export const STREAMS_COPY = {
  title: 'Streams',
  starting: 'Starting',
  progress: ({ position, duration }: ProgressProps) => `${position} of ${duration}`,
  client: ({ device, browser }: ClientProps) => `${device}, ${browser}`,
  watcher: ({ viewer, device }: WatcherProps) => `${viewer} on ${device}`,
  device: ({ device, browser }: ClientProps) => `${device} · ${browser}`,
  originalFile: 'The original file',
  copiedAsItIs: 'Copied as it is',
  convertedToH264: 'Converted to H.264',
  convertedTo: (quality: string) => `Converted to ${quality}`,
  viewer: 'Viewer',
  deviceTerm: 'Device',
  address: 'Address',
  video: 'Video',
  picture: 'Picture',
  codec: 'Codec',
  sentAs: 'Sent as',
  audio: 'Audio',
  track: 'Track',
  format: 'Format',
  bandwidth: 'Bandwidth',
  sendingNow: 'Sending now',
  measuring: 'Measuring',
  fileAverage: 'File average',
  mode: 'Mode',
  couldNotStop: (reason: string) => `Could not stop it: ${reason}`,
  howItPlays: 'How it plays',
  stop: 'Stop',
  stopStream: ({ title, device, browser }: StopStreamProps) =>
    `Stop ${title} on ${device}, ${browser}`,
  detailsToggle: ({ isOpen, title }: DetailsToggleProps) =>
    `${isOpen ? 'Hide' : 'Show'} the details of ${title}`,
  whatItDownloads: 'What it downloads',
  received: ({ received, size }: ReceivedProps) => `${received} of ${size}`,
  downloadRate: 'Download rate ',
  stopDownload: ({ title, device }: StopDownloadProps) => `Stop downloading ${title} to ${device}`,
  streaming: 'Streaming',
  stream: 'stream',
  streams: 'streams',
  nobodyStreaming: 'Nobody is streaming right now',
  downloading: 'Downloading',
  download: 'download',
  downloads: 'downloads',
  nothingDownloading: 'Nothing is downloading right now',
  lookingForStreams: 'Looking for streams',
  managersOnlyName: 'Streams',
  forAdmin: 'see who is streaming and to stop a stream',
  forOwner: 'see who is streaming and stop a stream',
  noAnswer: (reason: string) => `The server did not answer: ${reason}`,
} as const
