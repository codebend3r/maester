# raven: a home page, poster favourites, cards that show their sort, and a settings reset

## What was asked

- A new side menu entry, **Home**, with a house icon, that becomes the default page.
- Home shows every pinned library as a row in a grid. Each row shows at most eight entries: the newest arrivals in that library, newest first.
- The first row shows every movie and episode currently in progress.
- Favourites: clicking a favourite's title opens its movie or episode page. On that page, clicking the picture plays the video.
- In a library sorted by something (size, bitrate, recently added), each card shows that value; sorted by recently added, how long ago the video was added.
- Continue watching shows posters: the movie's, or the season's for an episode.
- Cards stop saying "Converted on the server"; they keep "Won't play in this browser".
- Favourites show the corresponding poster.
- Settings gets a button that resets every setting to its default, and an icon for every section.

## Decisions

- **Home lives at `/`; the libraries list moves to `/libraries`.** The logo and Home both lead to `/`. Links that meant "the list of libraries" (a library's back link, after deleting a library) now say `/libraries`.
- **One request: `GET /api/home`.** The server answers `{ inProgress, shelves }`. Each shelf is a pinned library's newest arrivals, in side menu order. Like favourites, the server leaves out libraries still locked to this browser, so Home never asks for the PIN on its own. One round trip instead of one per pinned library.
- **A shelf is a discriminated union on `type`.** A TV shows library gives `{ type: 'shows', shows: ShowEntry[] }` (shows by when their newest episode arrived, as the library's own page lists them). Any other library gives `{ type: 'media', media: MediaItem[] }`. The shelf carries `libraryId` only; the client reads the name and kind from the libraries it already holds, so they are not written twice.
- **Eight per shelf, enforced in SQL.** `MediaRepository.list` and `listShows` take an optional `limit`, so a row of eight never reads a whole library. A random sort shuffles first and then cuts.
- **In progress means a saved spot.** A video has one while `playback_progress` holds a row for it and its library saves progress (a finished or barely started video has none). Most recently watched first, every one of them; the row wraps when there are more than eight. A row that is empty is not shown.
- **Cards.** The in-progress row is posters (`PosterCard`): a movie wears its own, an episode its season's, else its show's, and a file matched to nothing its frame grab cropped to 2:3. The server picks the poster (`MetadataRepository.posterItems` climbs from the item to its parent and grandparent until one has a poster) and sends it with the video as `{ media, poster }`. On a poster an episode is named by its show and number (`cardTitle`). A Movies shelf uses posters (`PosterCard`), a TV shelf uses show posters (`ShowCard`), and anything else uses frame-grab cards, matching each library's own grid.
- **Layout.** A shelf is a grid of eight columns; four at `64rem` and below, two at `40rem` and below. The shelf heading links to the library.
- **`MediaCard` splits its link.** The picture always plays. The title opens the movie's or episode's page when the file is matched to one, and plays otherwise, as before. This fixes favourites and gives every frame-grab card the same behaviour as the poster cards.
- **The picture on a movie's or episode's page plays it.** The movie's poster becomes a play link with a play mark over it on hover and focus. An episode's page gains a 16:9 picture in the poster's place (its still, else the file's frame grab) that does the same.
- **Caches.** Home is `['home']` and is read again after anything that changes what it shows: watching, favouriting, deleting, refreshing or editing an item, a library saved, a library's folders changing, a matching pass, matching a file, and a reconnect.
- **A card shows its sort's value.** `sortFact` in `@raven/core` maps every sort to what a card says of it, as a `Record<MediaSort, ...>`, so a new sort cannot be forgotten: "Added 3 days ago" for recently added and oldest, "Changed 2 hours ago", the size, the bitrate, the resolution. The title, year and rating sorts add nothing, since cards show those already, and random has no value. `showSortFact` does the same for shows (when the newest episode came). The grid, grouped and tiles views pass the library's sort down; the list view has columns for these already. The value gets a line of its own above the facts, a shade brighter, so a long one never squeezes them on a narrow card, and a fact it repeats (the resolution) is not shown twice.
- **Favourites are posters too.** `GET /api/favourites` answers the same `{ media, poster }` entries as Home's in-progress row (`PosterEntry`), built by one `MediaRepository.withPosters`, and the page lays them out as a poster grid. Unfavouriting or deleting patches the cached entries in place as before.
- **Reset to defaults sends the defaults.** The button sends `DEFAULT_PLAYBACK_SETTINGS` through the existing `PUT /api/settings/playback`, so the server needs nothing new. It asks once more (Reset all, or Cancel) the way deleting a library does, is disabled while every setting is at its default, and says when it is done.
- **An icon for every section.** The Playback heading and each setting carry an icon of their own, new to the set: `playback`, `file-play`, `convert`, `resize`, `gauge`, `chip` and `sun`, and `reset` for the button. The design page lists them with the rest.
- **Converting is the page's to say.** Most 4K files are converted, so on a card "Converted on the server" is on nearly every poster and helps no choice. `PlaybackNote` takes `place: 'card' | 'page'`: a card warns only of a video that will not play at all, and the movie and episode pages say either, for the version Play starts, under the header.
- **One `timeAgo`.** The review cards' relative time moves to `@raven/core` with a `long` style beside the `narrow` one, so cards read "3 days ago" and "yesterday" while reviews keep "3d ago".

## Testing

- Server: `posterItems` gives a movie its own poster, an episode its season's, else its show's; `list` and `listShows` honour `limit`; `listInProgress` lists saved spots, most recent first, and drops them while a library saves no progress. The app answers `/api/home` with pinned libraries only, hides a locked one until it is unlocked, and sends no paths.
- Core: `sortFact` answers every sort, nothing for a file not probed yet; `timeAgo` in both styles.
- Web: favourites show a movie's poster and an episode's season's; Settings shows an icon per section and setting, resets only after the second click, keeps the settings on Cancel, and has nothing to reset at the defaults; a card says nothing of converting while the movie page does, and both warn of a video that will not play; Home renders the in-progress row first and one row per pinned library with at most eight cards; the side menu has Home at `/` and Libraries at `/libraries`; a matched favourite's title opens its page while its picture plays; the movie and episode pages play from their picture; cards, posters and show cards show their sort's value, and a library sorted by size shows each card's size.
