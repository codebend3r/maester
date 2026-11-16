import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  PLAYBACK_CHOICES,
} from '@raven/core'
import type { useServerSettingsSaves } from '@raven/ui/headless'
import { COMMON_COPY } from '@/lib/copy'
import { ADMIN_CHOICES_COPY } from '@/pages/SettingsPage/adminCopy'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { Setting, SettingsSection, SettingsSkeleton } from '@/pages/SettingsPage/Setting'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { Titled } from '@/pages/SettingsPage/Titled'
import { ToggleChoice } from '@/pages/SettingsPage/ToggleChoice'

/** The server's settings as Admin reads and saves them, which its header's Reset shares. */
type ServerSettingsSaves = ReturnType<typeof useServerSettingsSaves>

export type AdminPanelProps = { saves: ServerSettingsSaves }

/** Admin's first tab: how the server plays and converts video, then how pages show titles. Each choice saves as it is picked. */
export const AdminPlaybackPanel = ({
  saves: { playback, display, save, saveDisplay, reset },
}: AdminPanelProps) => (
  <>
    <SettingsSection
      icon="playback"
      title={SETTINGS_COPY.playback}
      hint={SETTINGS_COPY.playbackHint}
      isResetting={reset.isPending}
      query={playback}
      shape={<SettingsSkeleton count={Object.keys(DEFAULT_PLAYBACK_SETTINGS).length} />}
      saveError={save.failure}
    >
      {({ settings: current, effective }) => (
        <>
          <Setting
            values={PLAYBACK_CHOICES.directPlay}
            icon="file-play"
            label={SETTINGS_COPY.directPlay}
            choices={ADMIN_CHOICES_COPY.directPlay}
            value={current.directPlay}
            onChange={(directPlay) => save.mutate({ directPlay })}
          />
          <Setting
            values={PLAYBACK_CHOICES.transcoding}
            icon="convert"
            label={SETTINGS_COPY.transcoding}
            choices={ADMIN_CHOICES_COPY.transcoding}
            value={current.transcoding}
            onChange={(transcoding) => save.mutate({ transcoding })}
          />
          <Setting
            values={PLAYBACK_CHOICES.maxHeight}
            icon="resize"
            label={SETTINGS_COPY.maxHeight}
            choices={ADMIN_CHOICES_COPY.maxHeight}
            value={current.maxHeight}
            onChange={(maxHeight) => save.mutate({ maxHeight })}
          />
          <Setting
            values={PLAYBACK_CHOICES.quality}
            icon="gauge"
            label={SETTINGS_COPY.quality}
            choices={ADMIN_CHOICES_COPY.quality}
            value={current.quality}
            onChange={(quality) => save.mutate({ quality })}
          />
          <Setting
            values={PLAYBACK_CHOICES.hwAccel}
            icon="chip"
            label={SETTINGS_COPY.hwAccel}
            choices={ADMIN_CHOICES_COPY.hwAccel}
            value={current.hwAccel}
            onChange={(hwAccel) => save.mutate({ hwAccel })}
          />
          <p className={styles.hint}>
            {SETTINGS_COPY.encodesWith(ADMIN_CHOICES_COPY.encoders[effective.encoder])}
          </p>
          <fieldset className={styles.setting}>
            <legend className={styles.legend}>
              <Titled icon="sun">{COMMON_COPY.hdr}</Titled>
            </legend>
            <ToggleChoice
              label={SETTINGS_COPY.tonemap}
              hint={
                effective.tonemapAvailable
                  ? SETTINGS_COPY.tonemapHint
                  : SETTINGS_COPY.tonemapUnavailable
              }
              isChecked={current.tonemap}
              onChange={(tonemap) => save.mutate({ tonemap })}
            />
          </fieldset>
          <fieldset className={styles.setting}>
            <legend className={styles.legend}>
              <Titled icon="skipNext">{SETTINGS_COPY.markers}</Titled>
            </legend>
            <ToggleChoice
              label={SETTINGS_COPY.detectMarkers}
              hint={SETTINGS_COPY.detectMarkersHint}
              isChecked={current.detectMarkers}
              onChange={(detectMarkers) => save.mutate({ detectMarkers })}
            />
          </fieldset>
        </>
      )}
    </SettingsSection>
    <SettingsSection
      icon="image"
      title={SETTINGS_COPY.display}
      hint={SETTINGS_COPY.displayHint}
      isResetting={reset.isPending}
      query={display}
      shape={<SettingsSkeleton count={Object.keys(DEFAULT_DISPLAY_SETTINGS).length} />}
      saveError={saveDisplay.failure}
    >
      {(shown) => (
        <Setting
          icon="film"
          label={SETTINGS_COPY.movieTitles}
          values={DISPLAY_CHOICES.titles}
          choices={ADMIN_CHOICES_COPY.titles}
          value={shown.titles}
          onChange={(titles) => saveDisplay.mutate({ titles })}
        />
      )}
    </SettingsSection>
  </>
)
