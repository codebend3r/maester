import { type DynamicModule, Module } from '@nestjs/common'
import { AuthController } from '@/auth/authController'
import { PendingSignIns } from '@/auth/pendingSignIns'
import { SignInService } from '@/auth/signInService'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { HealthController } from '@/health/healthController'
import { InternalController } from '@/internal/internalController'
import { PLEX_TV_CLIENT, type PlexTv } from '@/plex/plexTv'
import { AccountService } from '@/sessions/accountService'
import { SessionsRepository } from '@/sessions/sessionsRepository'
import { UsersRepository } from '@/users/usersRepository'

type AppModuleRegisterProps = {
  config: ServerConfig
  plexTv: PlexTv
  clock: Clock
}

/** Takes its dependencies as arguments so a test can swap in a fake plex.tv and a movable clock. */
@Module({})
export class AppModule {
  static register({ config, plexTv, clock }: AppModuleRegisterProps): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, InternalController, HealthController],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        { provide: PLEX_TV_CLIENT, useValue: plexTv },
        { provide: CLOCK, useValue: clock },
        DatabaseService,
        UsersRepository,
        SessionsRepository,
        PendingSignIns,
        SignInService,
        AccountService,
      ],
    }
  }
}
