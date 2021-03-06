import type { LockProvider } from '#/lock';
import type { Logger } from '#/logger';
import { CancellationToken, compareByValueSelectionDescending, isDefined, round, Timer, toArray } from '#/utils';
import type { NewMigrationState } from './migration-state';
import type { MigrationStateRepository } from './migration-state-repository';

export type MigrationDefinition<T = void> = {
  name: string,
  migrations: Migration<T>[]
};

export type Migration<T = void> = {
  from: 'init' | number | number[],
  to: number,
  migrator: (control: MigrationControl) => Promise<T> | T
};

export type MigrationControl = {
  restart: () => void
};

export type MigrationResult<T> = {
  from: 'init' | number,
  to: number,
  time: number,
  result: T,
  restartRequested: boolean
};

export class Migrator {
  private readonly migrationStateRepository: MigrationStateRepository;
  private readonly lockProvider: LockProvider;
  private readonly logger: Logger;

  constructor(migrationStateRepository: MigrationStateRepository, lockProvider: LockProvider, logger: Logger) {
    this.migrationStateRepository = migrationStateRepository;
    this.lockProvider = lockProvider;
    this.logger = logger;
  }

  // eslint-disable-next-line max-statements, max-lines-per-function
  async migrate<T>({ name, migrations }: MigrationDefinition<T>): Promise<MigrationResult<T>[]> {
    if (migrations.length == 0) {
      throw new Error('no migrations provided');
    }

    const lock = this.lockProvider.get(`migrator-${name}`);

    // eslint-disable-next-line max-statements, max-lines-per-function
    const { result } = await lock.using(30000, true, async (): Promise<MigrationResult<T>[]> => {
      const results: MigrationResult<T>[] = [];

      while (true) {
        const restartToken = new CancellationToken();
        const control: MigrationControl = {
          restart: () => restartToken.set()
        };

        const currentState = await this.migrationStateRepository.tryLoadByFilter({ name });
        const currentRevision = currentState?.revision ?? 'init';
        const latestRevision = migrations.sort(compareByValueSelectionDescending((migration) => migration.to))[0]!.to;

        if (currentRevision == latestRevision) {
          break;
        }

        const suitableMigrations = migrations.filter((migration) => toArray(migration.from).includes(currentRevision));

        if (suitableMigrations.length == 0) {
          throw new Error(`no suitable migration path from current revision ${currentRevision} to latest revision ${latestRevision} found`);
        }

        const migration = suitableMigrations.sort(compareByValueSelectionDescending((m) => m.to))[0]!;

        this.logger.warn(`starting migration for "${name}" from revision ${currentRevision} to ${migration.to}`);

        let migratorResult!: T;
        const time = await Timer.measureAsync(async () => (migratorResult = await migration.migrator(control)));

        results.push({ from: currentRevision, to: migration.to, time, result: migratorResult, restartRequested: restartToken.isSet });

        if (restartToken.isSet) {
          this.logger.warn(`finished migration in ${round(time / 1000, 2)} seconds`);
          this.logger.warn('migration-restart requested');
          continue;
        }

        if (isDefined(currentState)) {
          await this.migrationStateRepository.patchByFilter({ name }, { revision: migration.to });
        }
        else {
          const newState: NewMigrationState = {
            name,
            revision: migration.to
          };

          await this.migrationStateRepository.insert(newState);
        }

        this.logger.warn(`finished migration in ${round(time / 1000, 2)} seconds`);
      }

      return results;
    });

    return result;
  }
}
