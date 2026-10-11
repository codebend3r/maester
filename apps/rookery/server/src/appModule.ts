import { type DynamicModule, Module } from '@nestjs/common'
import { AuthController } from '@/auth/authController.js'
import { PendingSignIns } from '@/auth/pendingSignIns.js'
import { SignInService } from '@/auth/signInService.js'
import { CLOCK, type Clock } from '@/clock.js'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'
import { DatabaseService } from '@/db/database.js'
import { HealthController } from '@/health/healthController.js'
import { InternalController } from '@/internal/internalController.js'
import { PLEX_TV_CLIENT, type PlexTv } from '@/plex/plexTv.js'
import { AccountService } from '@/sessions/accountService.js'
import { SessionsRepository } from '@/sessions/sessionsRepository.js'
import { UsersRepository } from '@/users/usersRepository.js'

/** Takes its dependencies as arguments so a test can swap in a fake plex.tv and a movable clock. */
@Module({})
export class AppModule {
  static register({
    config,
    plexTv,
    clock,
  }: {
    config: ServerConfig
    plexTv: PlexTv
    clock: Clock
  }): DynamicModule {
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
