import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
} from '@raven/core'
import { type ComponentType, useId, useState } from 'react'
import { BUTTON_TONES, Button } from '@raven/ui'
import { useServerSettingsSaves } from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { api } from '@/lib/api'
import { MANAGEMENT_MODES, useManagement } from '@/lib/management'
import { displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { AdminLockSection } from '@/pages/SettingsPage/AdminLockSection'
import { RemoteAccessSection } from '@/pages/SettingsPage/RemoteAccessSection'
import { ServerSection } from '@/pages/SettingsPage/ServerSection'
import {
  type Choices,
  Setting,
  SettingsSection,
  SettingsSkeleton,
} from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { UsersSection } from '@/pages/SettingsPage/UsersSection'
import { useIsDesktop } from '@/stores/desktop'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { ADMIN_CHOICES_COPY, ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import { ScanSwitch } from '@/pages/SettingsPage/ScanSwitch'
import { ToggleChoice } from '@/pages/SettingsPage/ToggleChoice'

const TITLES: Choices<DisplaySettings['titles']> = ADMIN_CHOICES_COPY.titles
const DIRECT_PLAY: Choices<PlaybackSettings['directPlay']> = ADMIN_CHOICES_COPY.directPlay
const TRANSCODING: Choices<PlaybackSettings['transcoding']> = ADMIN_CHOICES_COPY.transcoding
const MAX_HEIGHT: Choices<PlaybackSettings['maxHeight']> = ADMIN_CHOICES_COPY.maxHeight
const QUALITY: Choices<PlaybackSettings['quality']> = ADMIN_CHOICES_COPY.quality
const HW_ACCEL: Choices<PlaybackSettings['hwAccel']> = ADMIN_CHOICES_COPY.hwAccel
const ENCODER_NAMES = ADMIN_CHOICES_COPY.encoders

type ResetControlProps = {
  isConfirming: boolean
  isBusy: boolean
  isAllAtDefaults: boolean
  onReset: () => void
  onConfirming: (isConfirming: boolean) => void
}

type ResetConfirmProps = ResetControlProps

const ResetConfirm = ({ isBusy, onReset, onConfirming }: ResetConfirmProps) => (
  <div className={styles.asking}>
    <p className={styles.confirm}>{SETTINGS_COPY.resetConfirm}</p>
    <Button
      tone={BUTTON_TONES.primary}
      icon="reset"
      className={styles.resetAll}
      disabled={isBusy}
      onClick={onReset}
    >
      {SETTINGS_COPY.resetAll}
    </Button>
    <Button className={styles.cancel} onClick={() => onConfirming(false)}>
      {COMMON_COPY.cancel}
    </Button>
  </div>
)

type ResetAskProps = ResetControlProps

const ResetAsk = ({ isBusy, isAllAtDefaults, onConfirming }: ResetAskProps) => (
  <Button
    icon="reset"
    className={styles.reset}
    disabled={isBusy || isAllAtDefaults}
    onClick={() => onConfirming(true)}
  >
    {SETTINGS_COPY.resetToDefaults}
  </Button>
)

const RESET_STATES = { confirming: 'confirming', idle: 'idle' } as const
type ResetState = (typeof RESET_STATES)[keyof typeof RESET_STATES]

const RESET_VIEWS = {
  [RESET_STATES.confirming]: ResetConfirm,
  [RESET_STATES.idle]: ResetAsk,
} as const satisfies Record<ResetState, ComponentType<ResetControlProps>>

/** Reset to defaults, and once clicked, the second click that makes sure. */
const ResetControl = (props: ResetControlProps) => {
  const View = RESET_VIEWS[props.isConfirming ? RESET_STATES.confirming : RESET_STATES.idle]
  return <View {...props} />
}

/**
 * Server-wide settings and management, mounted only for an authorized admin.
 * Changes save optimistically; Reset asks for confirmation before restoring defaults.
 */
const ServerSettings = () => {
  const titleId = useId()
  const isDesktop = useIsDesktop()
  const [isConfirming, setConfirming] = useState(false)
  // Accounts show only to an approved viewer; the other states have a screen of their own.
  const access = useAccessState()
  const { mode } = useManagement()
  const { playback, display, save, saveDisplay, reset, isBusy, isAllAtDefaults } =
    useServerSettingsSaves({
      api,
      queries: { playbackSettingsQuery, displaySettingsQuery },
      onReset: () => setConfirming(false),
    })
  const settings = playback.data?.settings

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {ADMIN_COPY.heading}
        </PageTitle>
        {settings && (
          <ResetControl
            isConfirming={isConfirming}
            isBusy={isBusy}
            isAllAtDefaults={isAllAtDefaults}
            onReset={() => reset.mutate()}
            onConfirming={setConfirming}
          />
        )}
      </header>
      <output className={styles.status}>
        {reset.isSuccess && !!settings && isAllAtDefaults ? SETTINGS_COPY.resetDone : ''}
      </output>
      {reset.isError && (
        <p className={styles.error} role="alert">
          {SETTINGS_COPY.resetFailed}
          {reset.error.message}
        </p>
      )}
      {!isDesktop && <ServerSection />}
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
              choices={DIRECT_PLAY}
              value={current.directPlay}
              onChange={(directPlay) => save.mutate({ directPlay })}
            />
            <Setting
              values={PLAYBACK_CHOICES.transcoding}
              icon="convert"
              label={SETTINGS_COPY.transcoding}
              choices={TRANSCODING}
              value={current.transcoding}
              onChange={(transcoding) => save.mutate({ transcoding })}
            />
            <Setting
              values={PLAYBACK_CHOICES.maxHeight}
              icon="resize"
              label={SETTINGS_COPY.maxHeight}
              choices={MAX_HEIGHT}
              value={current.maxHeight}
              onChange={(maxHeight) => save.mutate({ maxHeight })}
            />
            <Setting
              values={PLAYBACK_CHOICES.quality}
              icon="gauge"
              label={SETTINGS_COPY.quality}
              choices={QUALITY}
              value={current.quality}
              onChange={(quality) => save.mutate({ quality })}
            />
            <Setting
              values={PLAYBACK_CHOICES.hwAccel}
              icon="chip"
              label={SETTINGS_COPY.hwAccel}
              choices={HW_ACCEL}
              value={current.hwAccel}
              onChange={(hwAccel) => save.mutate({ hwAccel })}
            />
            <p className={styles.hint}>
              {SETTINGS_COPY.encodesWith(ENCODER_NAMES[effective.encoder])}
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
            choices={TITLES}
            value={shown.titles}
            onChange={(titles) => saveDisplay.mutate({ titles })}
          />
        )}
      </SettingsSection>
      <RemoteAccessSection />
      <ScanSwitch />
      {access.kind === ACCESS_KINDS.approved && access.account.isOwner && (
        <UsersSection key={access.account.id} userId={access.account.id} />
      )}
      {mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </section>
  )
}

export const AdminPage = () => {
  const { mode, canManage } = useManagement()
  return (
    <>
      {canManage && <ServerSettings />}
      {!canManage && mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </>
  )
}
