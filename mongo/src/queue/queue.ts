import type { Logger } from '@tstdl/base/logger';
import type { Job, Queue } from '@tstdl/base/queue';
import type { BackoffOptions, CancellationToken } from '@tstdl/base/utils';
import { Alphabet, backoffGenerator, BackoffStrategy, currentTimestamp, getRandomString, toArray } from '@tstdl/base/utils';
import type { FilterQuery, UpdateQuery } from 'mongodb';
import { MongoEntityRepository, noopTransformer } from '../entity-repository';
import type { MongoDocument } from '../model';
import type { Collection, TypedIndexSpecification } from '../types';
import type { MongoJob, MongoJobWithoutId } from './job';

const backoffOptions: BackoffOptions = {
  strategy: BackoffStrategy.Exponential,
  initialDelay: 100,
  increase: 2,
  maximumDelay: 5000
};

const indexes: TypedIndexSpecification<MongoJob<any>>[] = [
  { name: 'enqueueTimestamp_lastDequeueTimestamp_tries', key: { enqueueTimestamp: 1, lastDequeueTimestamp: 1, tries: 1 } },
  { name: 'batch', key: { batch: 1 } }
];

export class MongoQueue<T> implements Queue<T> {
  private readonly repository: MongoEntityRepository<MongoJob<T>>;
  private readonly processTimeout: number;
  private readonly maxTries: number;

  constructor(collection: Collection<MongoJob<T>>, processTimeout: number, maxTries: number, logger: Logger) {
    this.repository = new MongoEntityRepository<MongoJob<T>>(collection, noopTransformer, { logger, indexes, entityName: 'mongo-job' });
    this.processTimeout = processTimeout;
    this.maxTries = maxTries;
  }

  async initialize(): Promise<void> {
    return this.repository.initialize();
  }

  async enqueue(data: T): Promise<Job<T>> {
    const newJob: MongoJobWithoutId<T> = {
      data,
      enqueueTimestamp: currentTimestamp(),
      tries: 0,
      lastDequeueTimestamp: 0,
      batch: null
    };

    const job = await this.repository.insert(newJob);
    return toModelJob(job);
  }

  async enqueueMany(data: T[]): Promise<Job<T>[]> {
    const now = currentTimestamp();

    const newJobs: MongoJobWithoutId<T>[] = data.map((item): MongoJobWithoutId<T> => ({
      data: item,
      enqueueTimestamp: now,
      tries: 0,
      lastDequeueTimestamp: 0,
      batch: null
    }));

    const jobs = await this.repository.insertMany(newJobs);
    return jobs.map(toModelJob);
  }

  async dequeue(): Promise<Job<T> | undefined> {
    const { filter, update } = getDequeueFindParameters(this.maxTries, this.processTimeout);

    const job = await this.repository.baseRepository.tryLoadByFilterAndUpdate(
      filter,
      update,
      {
        returnOriginal: false,
        sort: [['enqueueTimestamp', 1], ['lastDequeueTimestamp', 1], ['tries', 1]]
      }
    );

    return (job == undefined) ? undefined : toModelJob(job);
  }

  async dequeueMany(count: number): Promise<Job<T>[]> {
    const batch = getRandomString(20, Alphabet.LowerUpperCaseNumbers);
    const { filter, update } = getDequeueFindParameters(this.maxTries, this.processTimeout, batch);

    const bulk = this.repository.baseRepository.bulk();

    for (let i = 0; i < count; i++) {
      bulk.update(filter, update);
    }

    await bulk.execute();

    const jobs = await this.repository.loadManyByFilter({ batch });

    return jobs.map(toModelJob);
  }

  async acknowledge(jobOrJobs: Job<T> | Job<T>[]): Promise<void> {
    const jobIds = toArray(jobOrJobs).map((job) => job.id);
    await this.repository.deleteManyById(jobIds);
  }

  async *getConsumer(cancellationToken: CancellationToken): AsyncIterableIterator<Job<T>> {
    for await (const backoff of backoffGenerator(backoffOptions, cancellationToken)) {
      const job = await this.dequeue();

      if (job != undefined) {
        yield job;
      }
      else {
        backoff();
      }
    }
  }

  async *getBatchConsumer(size: number, cancellationToken: CancellationToken): AsyncIterableIterator<Job<T>[]> {
    for await (const backoff of backoffGenerator(backoffOptions, cancellationToken)) {
      const jobs = await this.dequeueMany(size);

      if (jobs.length > 0) {
        yield jobs;
      }
      else {
        backoff();
      }
    }
  }
}

function toModelJob<T>(mongoJob: MongoJob<T>): Job<T> {
  const job: Job<T> = {
    id: mongoJob.id,
    data: mongoJob.data
  };

  return job;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getDequeueFindParameters(maxTries: number, processTimeout: number, batch: null | string = null) {
  const now = currentTimestamp();
  const maximumLastDequeueTimestamp = now - processTimeout;

  const filter: FilterQuery<MongoDocument<MongoJob<any>>> = {
    tries: { $lt: maxTries },
    lastDequeueTimestamp: { $lte: maximumLastDequeueTimestamp }
  };

  const update: UpdateQuery<MongoDocument<MongoJob<any>>> = {
    $inc: { tries: 1 },
    $set: {
      lastDequeueTimestamp: now,
      batch
    }
  };

  return { filter, update };
}
