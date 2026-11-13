export const ADMIN_COPY = {
  heading: 'Admin',
  scans: 'Library scans',
  stop: 'Cancel all running scans',
  hint: 'Shows scans running across every library. Cancelling stops only the work running now; scans can be started again from each library.',
  fullScan: 'Full scan',
  quickScan: 'Quick scan',
  ratings: 'Updating ratings',
} as const

/** The words of each of Admin's playback and display choices, and of each encoder it names. */
export const ADMIN_CHOICES_COPY = {
  titles: {
    logo: {
      label: 'Logo',
      hint: 'A movie’s or show’s page shows its title as TMDB’s logo art where it has one, else in words.',
    },
    text: { label: 'Text', hint: 'Every movie’s and show’s page spells its title out in type.' },
  },

  directPlay: {
    auto: {
      label: 'When the browser can',
      hint: 'The original file plays as it is when the browser takes it; otherwise the server converts it.',
    },
    force: {
      label: 'Always',
      hint: 'The original file is always sent, whatever the check says, unless another audio track is picked and the server can remux for it. For a browser the check underrates; a file it cannot decode will not play.',
    },
  },

  transcoding: {
    on: {
      label: 'Remux and transcode',
      hint: 'Video is repackaged when the browser can decode it and re-encoded when it cannot.',
    },
    remuxOnly: {
      label: 'Remux only',
      hint: 'Video is never re-encoded; a file the browser cannot decode will not play. Easy on the CPU.',
    },
    off: {
      label: 'Off',
      hint: 'Nothing is converted; only files the browser plays as they are play.',
    },
  },

  maxHeight: {
    2160: { label: '4K', hint: 'Transcodes keep the full frame.' },
    1080: { label: '1080p', hint: 'A 4K file is scaled to 1080p; a smaller one is left alone.' },
    720: { label: '720p', hint: 'For a slow network or a small screen.' },
  },

  quality: {
    low: { label: 'Low', hint: 'Smallest stream; fine on a phone.' },
    medium: { label: 'Medium', hint: 'A good picture at a moderate bitrate.' },
    high: { label: 'High', hint: 'Near the source; needs a fast network.' },
  },

  hwAccel: {
    auto: { label: 'Auto', hint: 'The GPU this machine has, after a test encode; else the CPU.' },
    none: { label: 'CPU only', hint: 'libx264 on the CPU, whatever the machine has.' },
    vaapi: { label: 'VAAPI', hint: 'An Intel or AMD GPU on Linux, through its render node.' },
    videotoolbox: { label: 'VideoToolbox', hint: 'The media engine in a Mac.' },
  },

  encoders: {
    software: 'libx264 on the CPU',
    vaapi: 'VAAPI',
    videotoolbox: 'VideoToolbox',
  },
} as const
