/* eslint-disable @typescript-eslint/semi */
import type { Entity, EntityPatch, EntityRepository, MaybeNewEntity, Query, QueryOptions, UpdateOptions } from '#/database';
import type { Logger } from '#/logger';
import { equals, isDefined, isUndefined } from '#/utils';
import type { LoadOptions } from './mongo-base.repository';
import { MongoBaseRepository } from './mongo-base.repository';
import { convertQuery, convertSort } from './query-converter';
import type { Collection, Filter, TypedIndexDescription, UpdateFilter } from './types';

type MongoEntityRepositoryOptions<T extends Entity> = {
  logger: Logger,
  entityName?: string,
  indexes?: TypedIndexDescription<T>[]
}

export type MappingItem<T extends Entity, TDb extends Entity, TKey extends keyof T = keyof T, TDbKey extends keyof TDb = keyof TDb> =
  { key: TDbKey, transform: (value: T[TKey]) => any };

export function mapTo<T extends Entity, TDb extends Entity, TKey extends keyof T, TDbKey extends keyof TDb>(key: TDbKey, transform: (value: T[TKey]) => TDb[TDbKey]): MappingItem<T, TDb, TKey, TDbKey> {
  return { key, transform };
}

export type TransformerMapping<T extends Entity, TDb extends Entity> = { [P in keyof T]?: MappingItem<T, TDb, P> };

export type TransformerMappingMap<T extends Entity, TDb extends Entity> = Map<keyof T, MappingItem<T, TDb>>;

export type EntityTransformer<T extends Entity, TDb extends Entity> = {
  transform: (item: MaybeNewEntity<T>) => MaybeNewEntity<TDb>,
  untransform: (item: TDb) => T,
  mapping: TransformerMapping<T, TDb>
}

export const noopTransformerFunction = <T>(item: T): T => item;

export const noopTransformer: EntityTransformer<any, any> = {
  transform: noopTransformerFunction,
  untransform: noopTransformerFunction,
  mapping: {}
}

export function getNoopTransformer<T extends Entity = any>(): EntityTransformer<T, T> {
  return noopTransformer;
}


export class MongoEntityRepository<T extends Entity, TDb extends Entity = T> implements EntityRepository<T> {
  readonly _type: T;

  /* eslint-disable @typescript-eslint/member-ordering */
  readonly collection: Collection<TDb>;
  readonly logger: Logger;
  readonly indexes?: TypedIndexDescription<TDb>[];
  readonly baseRepository: MongoBaseRepository<TDb>;
  readonly transformer: EntityTransformer<T, TDb>;
  readonly transformerMappingMap: TransformerMappingMap<T, TDb>;
  /* eslint-enable @typescript-eslint/member-ordering */

  constructor(collection: Collection<TDb>, transformer: EntityTransformer<T, TDb>, { logger, indexes, entityName }: MongoEntityRepositoryOptions<TDb>) {
    this.collection = collection;
    this.logger = logger.prefix(`${collection.collectionName}: `);
    this.indexes = indexes;
    this.transformer = transformer;

    this.baseRepository = new MongoBaseRepository(collection, { entityName });

    this.transformerMappingMap = new Map(Object.entries(transformer.mapping) as [keyof T, MappingItem<T, TDb>][]);
  }

  async initialize(): Promise<void> {
    const indexes = this.indexes;

    if (isUndefined(indexes)) {
      return;
    }

    const existingRawIndexes = await this.collection.indexes() as (TypedIndexDescription<any> & { v: number })[];
    const existingIndexes = existingRawIndexes.map(normalizeIndex).filter((index) => index.name != '_id_');

    const indexesWithoutName = indexes.filter((index) => index.name == undefined);

    if (indexesWithoutName.length > 0) {
      for (const index of indexesWithoutName) {
        this.logger.error(`missing name for index ${JSON.stringify(index)}`);
      }

      throw new Error(`indexes are required to have names (collection: ${this.collection.collectionName}, entity-name: ${this.baseRepository.entityName})`);
    }

    const unwantedIndexes = existingIndexes.filter((existingIndex) => !indexes.some((index) => equals(existingIndex, normalizeIndex(index), { deep: true, sortArray: false })));
    const requiredIndexes = indexes.filter((wantedIndex) => !existingIndexes.some((index) => equals(normalizeIndex(wantedIndex), index, { deep: true, sortArray: false })));

    for (const unwantedIndex of unwantedIndexes) {
      this.logger.warn(`dropping index ${unwantedIndex.name!}`);
      await this.collection.dropIndex(unwantedIndex.name!);
    }

    if (requiredIndexes.length > 0) {
      const indexNames = requiredIndexes.map((index, i) => index.name ?? `unnamed${i}`);
      this.logger.warn(`creating indexes ${indexNames.join(', ')}`);
      await this.baseRepository.createIndexes(requiredIndexes);
    }
  }

  async load<U extends T = T>(id: string): Promise<U> {
    const entity = await this.baseRepository.load(id);
    return this.transformer.untransform(entity) as U;
  }

  async tryLoad<U extends T = T>(id: string): Promise<U | undefined> {
    const entity = await this.baseRepository.tryLoad(id);
    return entity == undefined ? undefined : this.transformer.untransform(entity) as U;
  }

  async loadMany<U extends T = T>(ids: string[], options?: QueryOptions<U>): Promise<U[]> {
    const entities = await this.baseRepository.loadManyById(ids, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return entities.map((entity) => this.transformer.untransform(entity) as U);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *loadManyCursor<U extends T = T>(ids: string[], options?: QueryOptions<U>): AsyncIterableIterator<U> {
    for await (const entity of this.baseRepository.loadManyByIdWithCursor(ids, convertOptions(options as QueryOptions<T>, this.transformerMappingMap))) {
      yield this.transformer.untransform(entity) as U;
    }
  }

  async loadByFilter<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): Promise<U> {
    const transformedFilter = this.transformFilter(filter);
    const entity = await this.baseRepository.loadByFilter(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return this.transformer.untransform(entity) as U;
  }

  async tryLoadByFilter<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): Promise<U | undefined> {
    const transformedFilter = this.transformFilter(filter);
    const entity = await this.baseRepository.tryLoadByFilter(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return entity == undefined ? undefined : this.transformer.untransform(entity) as U;
  }

  async loadManyByFilter<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): Promise<U[]> {
    const transformedFilter = this.transformFilter(filter);
    const entities = await this.baseRepository.loadManyByFilter(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return entities.map(this.transformer.untransform) as U[];
  }

  async *loadManyByFilterCursor<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): AsyncIterableIterator<U> {
    const transformedFilter = this.transformFilter(filter);

    for await (const entity of this.baseRepository.loadManyByFilterWithCursor(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap))) {
      yield this.transformer.untransform(entity) as U;
    }
  }

  async loadAll<U extends T = T>(options?: QueryOptions<U>): Promise<U[]> {
    const entities = await this.baseRepository.loadManyByFilter({}, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return entities.map((entity) => this.transformer.untransform(entity) as U);
  }

  async *loadAllCursor<U extends T = T>(options?: QueryOptions<U>): AsyncIterableIterator<U> {
    for await (const entity of this.baseRepository.loadManyByFilterWithCursor({}, convertOptions(options as QueryOptions<T>, this.transformerMappingMap))) {
      yield this.transformer.untransform(entity) as U;
    }
  }

  async loadAndDelete<U extends T = T>(id: string): Promise<U> {
    return this.loadByFilterAndDelete({ id } as Query<U>);
  }

  async tryLoadAndDelete<U extends T = T>(id: string): Promise<U | undefined> {
    return this.tryLoadByFilterAndDelete({ id } as Query<U>);
  }

  async loadByFilterAndDelete<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): Promise<U> {
    const transformedFilter = this.transformFilter(filter);
    const entity = await this.baseRepository.loadByFilterAndDelete(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return this.transformer.untransform(entity) as U;
  }

  async tryLoadByFilterAndDelete<U extends T = T>(filter: Query<U>, options?: QueryOptions<U>): Promise<U | undefined> {
    const transformedFilter = this.transformFilter(filter);
    const entity = await this.baseRepository.tryLoadByFilterAndDelete(transformedFilter, convertOptions(options as QueryOptions<T>, this.transformerMappingMap));
    return entity == undefined ? undefined : this.transformer.untransform(entity) as U;
  }

  async loadAndPatch<U extends T = T>(id: string, patch: EntityPatch<U>, includePatch: boolean): Promise<U> {
    return this.loadByFilterAndPatch({ id } as Query<U>, patch, includePatch);
  }

  async tryLoadAndPatch<U extends T = T>(id: string, patch: EntityPatch<U>, includePatch: boolean): Promise<U | undefined> {
    return this.tryLoadByFilterAndPatch({ id } as Query<U>, patch, includePatch);
  }

  async loadByFilterAndPatch<U extends T = T>(filter: Query<U>, patch: EntityPatch<U>, includePatch: boolean, options?: QueryOptions<U>): Promise<U> {
    const transformedFilter = this.transformFilter(filter);
    const update = this.transformPatch(patch);
    const loadOptions = convertOptions(options as QueryOptions<T>, this.transformerMappingMap) ?? {};
    const entity = await this.baseRepository.loadByFilterAndUpdate(transformedFilter, update, { ...loadOptions, returnDocument: includePatch ? 'after' : 'before' });

    return this.transformer.untransform(entity) as U;
  }

  async tryLoadByFilterAndPatch<U extends T = T>(filter: Query<U>, patch: EntityPatch<U>, includePatch: boolean, options?: QueryOptions<U>): Promise<U | undefined> {
    const transformedFilter = this.transformFilter(filter);
    const update = this.transformPatch(patch);
    const loadOptions = convertOptions(options as QueryOptions<T>, this.transformerMappingMap) ?? {};
    const entity = await this.baseRepository.tryLoadByFilterAndUpdate(transformedFilter, update, { ...loadOptions, returnDocument: includePatch ? 'after' : 'before' });

    return entity == undefined ? undefined : this.transformer.untransform(entity) as U;
  }

  async has(id: string): Promise<boolean> {
    return this.baseRepository.has(id);
  }

  async hasByFilter<U extends T>(filter: Query<U>): Promise<boolean> {
    const transformedFilter = this.transformFilter(filter);
    return this.baseRepository.hasByFilter(transformedFilter);
  }

  async hasMany(ids: string[]): Promise<string[]> {
    return this.baseRepository.hasMany(ids);
  }

  async hasAll(ids: string[]): Promise<boolean> {
    return this.baseRepository.hasAll(ids);
  }

  async count(allowEstimation: boolean = false): Promise<number> {
    if (allowEstimation) {
      return this.baseRepository.countByFilterEstimated();
    }

    return this.baseRepository.countByFilter({});
  }

  async countByFilter<U extends T>(filter: Query<U>, _allowEstimation: boolean = false): Promise<number> {
    const transformedFilter = this.transformFilter(filter);
    return this.baseRepository.countByFilter(transformedFilter);
  }

  async patch<U extends T = T>(entity: U, patch: EntityPatch<U>): Promise<boolean> {
    const transformedPatch = this.transformPatch(patch);
    const { matchedCount } = await this.baseRepository.update({ _id: entity.id } as Filter<TDb>, transformedPatch);
    return matchedCount > 0;
  }

  async patchMany<U extends T = T>(entities: U[], patch: EntityPatch<U>): Promise<number> {
    const transformedPatch = this.transformPatch(patch);
    const ids = entities.map((entity) => entity.id);

    const { matchedCount } = await this.baseRepository.updateMany({ _id: { $in: ids } } as Filter<TDb>, transformedPatch);
    return matchedCount;
  }

  async patchByFilter<U extends T = T>(filter: Query<U>, patch: EntityPatch<U>): Promise<boolean> {
    const transformedFilter = this.transformFilter(filter);
    const transformedPatch = this.transformPatch(patch);

    const { matchedCount } = await this.baseRepository.update(transformedFilter, transformedPatch);
    return matchedCount > 0;
  }

  async patchManyByFilter<U extends T = T>(filter: Query<U>, patch: EntityPatch<U>): Promise<number> {
    const transformedFilter = this.transformFilter(filter);
    const transformedPatch = this.transformPatch(patch);

    const { matchedCount } = await this.baseRepository.updateMany(transformedFilter, transformedPatch);
    return matchedCount;
  }

  async insert<U extends T>(entity: MaybeNewEntity<U>): Promise<U> {
    const transformed = this.transformer.transform(entity as any as T);
    const insertedEntity = await this.baseRepository.insert(transformed);
    return this.transformer.untransform(insertedEntity) as U;
  }

  async insertMany<U extends T>(entities: MaybeNewEntity<U>[]): Promise<U[]> {
    const transformed = entities.map((entity) => this.transformer.transform(entity as any as T));
    const insertedEntities = await this.baseRepository.insertMany(transformed);
    return insertedEntities.map((insertedEntity) => this.transformer.untransform(insertedEntity) as U)
  }

  async update<U extends T>(entity: U, options?: UpdateOptions): Promise<boolean> {
    const transformed = this.transformer.transform(entity as any as T) as TDb;
    return this.baseRepository.replace(transformed, options);
  }

  async updateMany<U extends T>(entities: U[], options?: UpdateOptions): Promise<number> {
    const transformed = entities.map((entity) => this.transformer.transform(entity as any as T) as TDb);
    return this.baseRepository.replaceMany(transformed, options);
  }

  async delete<U extends T>(entity: U): Promise<boolean> {
    return this.baseRepository.deleteById(entity.id);
  }

  async deleteMany<U extends T>(entities: U[]): Promise<number> {
    const ids = entities.map((entity) => entity.id);
    return this.baseRepository.deleteManyById(ids);
  }

  async deleteById(id: string): Promise<boolean> {
    return this.baseRepository.deleteById(id);
  }

  async deleteManyById(ids: string[]): Promise<number> {
    return this.baseRepository.deleteManyById(ids);
  }

  async deleteByFilter<U extends T = T>(filter: Query<U>): Promise<boolean> {
    const transformedFilter = this.transformFilter(filter);
    return this.baseRepository.deleteByFilter(transformedFilter);
  }

  async deleteManyByFilter<U extends T = T>(filter: Query<U>): Promise<number> {
    const transformedFilter = this.transformFilter(filter);
    return this.baseRepository.deleteManyByFilter(transformedFilter);
  }

  private transformFilter<U extends T = T>(filter: Query<U>): Filter<TDb> {
    return convertQuery(filter, this.transformerMappingMap as TransformerMappingMap<U, TDb>);
  }

  private transformPatch<U extends T = T>(patch: EntityPatch<U>): UpdateFilter<TDb> {
    const transformedPatch: Record<string, any> = {};

    for (const [property, value] of Object.entries(patch)) {
      const mapping = this.transformerMappingMap.get(property as keyof T);

      if (isDefined(mapping)) {
        transformedPatch[mapping.key as string] = mapping.transform(value as T[keyof T]);
      }
      else {
        transformedPatch[property] = value;
      }
    }

    return { $set: { ...transformedPatch } } as UpdateFilter<TDb>;
  }
}

function normalizeIndex(index: TypedIndexDescription<any> & { v?: any, background?: any, ns?: any }): TypedIndexDescription<any> {
  const { v, background, ns, ...indexRest } = index;
  return indexRest;
}

function convertOptions<T extends Entity, TDb extends Entity>(options: QueryOptions<T> | undefined, mappingMap: TransformerMappingMap<T, TDb>): LoadOptions<TDb> | undefined {
  if (options == undefined) {
    return undefined;
  }

  const loadOptions: LoadOptions<TDb> = {
    skip: options.skip,
    limit: options.limit,
    sort: options.sort?.map((item) => convertSort(item, mappingMap))
  };

  return loadOptions;
}
