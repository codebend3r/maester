import { MIGRATION_001 } from '@/db/migrations/migration001CreateLibraries'
import { MIGRATION_002 } from '@/db/migrations/migration002CreateFavourites'
import { MIGRATION_003 } from '@/db/migrations/migration003AddLibrariesSaveProgress'
import { MIGRATION_004 } from '@/db/migrations/migration004AddLibrariesSort'
import { MIGRATION_005 } from '@/db/migrations/migration005AddMediaTracks'
import { MIGRATION_006 } from '@/db/migrations/migration006CreatePlays'
import { MIGRATION_007 } from '@/db/migrations/migration007AddLibrariesKind'
import { MIGRATION_008 } from '@/db/migrations/migration008CreateItems'
import { MIGRATION_009 } from '@/db/migrations/migration009CreateReviews'
import { MIGRATION_010 } from '@/db/migrations/migration010UpdateLibraries'
import { MIGRATION_011 } from '@/db/migrations/migration011CreateItemOverrides'
import { MIGRATION_012 } from '@/db/migrations/migration012CreateSettings'
import { MIGRATION_013 } from '@/db/migrations/migration013DropShownItems'
import { MIGRATION_014 } from '@/db/migrations/migration014AddLibrariesAutoRefresh'
import { MIGRATION_015 } from '@/db/migrations/migration015AddLibrariesLocked'
import { MIGRATION_016 } from '@/db/migrations/migration016AddItemsSagaTmdbId'
import { MIGRATION_017 } from '@/db/migrations/migration017AddItemsLogoChecked'
import { MIGRATION_018 } from '@/db/migrations/migration018AddMediaSplit'
import { MIGRATION_019 } from '@/db/migrations/migration019AddLibrariesFolderLayout'
import { MIGRATION_020 } from '@/db/migrations/migration020CreateAiDecisions'
import { MIGRATION_021 } from '@/db/migrations/migration021AddLibrariesIcon'
import { MIGRATION_022 } from '@/db/migrations/migration022CreateSagaBackdrops'
import { MIGRATION_023 } from '@/db/migrations/migration023DropShownItems'
import { MIGRATION_024 } from '@/db/migrations/migration024IndexMediaLibraryUnmatched'
import { MIGRATION_025 } from '@/db/migrations/migration025AddPlaysKind'
import { MIGRATION_026 } from '@/db/migrations/migration026AddLibrariesFullScannedAt'
import { MIGRATION_027 } from '@/db/migrations/migration027UpdateItems'
import { MIGRATION_028 } from '@/db/migrations/migration028AddPeopleImdbId'
import { MIGRATION_029 } from '@/db/migrations/migration029AddRatingsProvider'
import { MIGRATION_030 } from '@/db/migrations/migration030CreateScoreRequests'
import { MIGRATION_031 } from '@/db/migrations/migration031CreateProgressByAccount'
import { MIGRATION_032 } from '@/db/migrations/migration032CreateBugReports'
import { MIGRATION_033 } from '@/db/migrations/migration033AddMediaKeyframes'
import { MIGRATION_034 } from '@/db/migrations/migration034CreateHeroPicks'
import { MIGRATION_035 } from '@/db/migrations/migration035AddLibrariesInHero'
import { MIGRATION_036 } from '@/db/migrations/migration036UpdateLibraries'
import { MIGRATION_037 } from '@/db/migrations/migration037AddLibrariesPosition'
import { MIGRATION_038 } from '@/db/migrations/migration038AddMediaChapters'
import { MIGRATION_039 } from '@/db/migrations/migration039AddMediaMarkers'
import { MIGRATION_040 } from '@/db/migrations/migration040UpdateLibraries'
import { MIGRATION_041 } from '@/db/migrations/migration041CreateLibraryItemImages'
import { MIGRATION_042 } from '@/db/migrations/migration042CreateArtists'
import { MIGRATION_043 } from '@/db/migrations/migration043AddAlbumsMatch'
import { MIGRATION_044 } from '@/db/migrations/migration044CreatePlaylists'
import { MIGRATION_045 } from '@/db/migrations/migration045AddAlbumsReleaseDate'
import { MIGRATION_046 } from '@/db/migrations/migration046AddTracksLoudnessState'
import { MIGRATION_047 } from '@/db/migrations/migration047UpdateOr'
import { MIGRATION_048 } from '@/db/migrations/migration048CreateScrobbleLinks'
import { MIGRATION_049 } from '@/db/migrations/migration049AddPlaylistsIsShared'
import { MIGRATION_050 } from '@/db/migrations/migration050CreateBingeShows'
import { MIGRATION_051 } from '@/db/migrations/migration051UpdateItems'
import { MIGRATION_052 } from '@/db/migrations/migration052UpdateAlbums'
import { MIGRATION_053 } from '@/db/migrations/migration053AddMediaDolbyVisionOnly'
import { MIGRATION_054 } from '@/db/migrations/migration054CreatePlayHistory'
import { MIGRATION_055 } from '@/db/migrations/migration055CreateNotifications'
import { MIGRATION_056 } from '@/db/migrations/migration056CreateCaptionStyles'
import { MIGRATION_057 } from '@/db/migrations/migration057CreateDownloadRequests'
import { MIGRATION_058 } from '@/db/migrations/migration058AddMediaDolbyVisionProfile'

/**
 * raven's schema, one version per entry, a file each; `openSqlite` runs the ones a
 * database has not run yet. Append new migrations; never edit a shipped one,
 * since existing databases have already run it.
 */
export const MIGRATIONS: readonly string[] = [
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
  MIGRATION_006,
  MIGRATION_007,
  MIGRATION_008,
  MIGRATION_009,
  MIGRATION_010,
  MIGRATION_011,
  MIGRATION_012,
  MIGRATION_013,
  MIGRATION_014,
  MIGRATION_015,
  MIGRATION_016,
  MIGRATION_017,
  MIGRATION_018,
  MIGRATION_019,
  MIGRATION_020,
  MIGRATION_021,
  MIGRATION_022,
  MIGRATION_023,
  MIGRATION_024,
  MIGRATION_025,
  MIGRATION_026,
  MIGRATION_027,
  MIGRATION_028,
  MIGRATION_029,
  MIGRATION_030,
  MIGRATION_031,
  MIGRATION_032,
  MIGRATION_033,
  MIGRATION_034,
  MIGRATION_035,
  MIGRATION_036,
  MIGRATION_037,
  MIGRATION_038,
  MIGRATION_039,
  MIGRATION_040,
  MIGRATION_041,
  MIGRATION_042,
  MIGRATION_043,
  MIGRATION_044,
  MIGRATION_045,
  MIGRATION_046,
  MIGRATION_047,
  MIGRATION_048,
  MIGRATION_049,
  MIGRATION_050,
  MIGRATION_051,
  MIGRATION_052,
  MIGRATION_053,
  MIGRATION_054,
  MIGRATION_055,
  MIGRATION_056,
  MIGRATION_057,
  MIGRATION_058,
]
