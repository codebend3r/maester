## Picture and sound, on any device

Menu names move between Plex app versions. If a setting isn't where this says, look under **Settings**, then **Quality**, **Video** or **Advanced**.

**Quality.** Plex apps pick a quality for streams at home and another for streams away from home ("remote" or "internet" streaming), and the remote one is often set low out of the box. Set **Home streaming** to **Original** (or **Maximum**). Set **Remote streaming** to Original too when your connection is good, and lower it on slow wifi or mobile data. A quality below the file makes the server convert the video on the fly, so don't lower it at home.

**Relay.** When Plex can't reach the server directly from where you are, it sends the stream through Plex's relay, which carries at most 2 Mbps: the picture goes soft or it buffers. There's no switch for this in your app; the relay is the server's setting, and the admin turns it off once direct connections work. If a stream looks bad away from home, tell me "it's laggy" and I'll check whether you're on the relay and what to set meanwhile.

**Direct Play.** Leave **Direct Play** and **Direct Stream** on (usually under Advanced or Player settings), so the server sends the file as it is when your device can play it.

**Subtitles.** Some subtitles are pictures (PGS). The server has to burn those into the video, which can stall. If a stream stutters with subtitles on, pick a text (SRT) track, or turn them off.

**Sound.** TrueHD and DTS soundtracks pass straight through to a receiver only when the app's **audio passthrough** is on and your speakers decode them. With a TV or soundbar that doesn't, turn passthrough off (or limit it to what your speakers support), or pick another audio track.

**Stuck?** Tell me what you're watching and on what, and I'll look at the stream.
