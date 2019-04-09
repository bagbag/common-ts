import { SyncEnumerable } from '@common-ts/base/enumerable';
import * as Mongo from 'mongodb';
import { Entity, EntityWithPartialId } from './entity';
import { MongoDocument, toEntity, toMongoDocumentWithPartialId } from './mongo-document';
import { IdsMap, objectIdOrStringToString, stringToObjectIdOrString } from './utils';

export type FilterQuery<T extends Entity> = Mongo.FilterQuery<MongoDocument<T>>;

export class MongoBaseRepository<T extends Entity> {
  private readonly collection: Mongo.Collection<MongoDocument<T>>;

  constructor(collection: Mongo.Collection<MongoDocument<T>>) {
    this.collection = collection;
  }

  async insert(entity: EntityWithPartialId<T>): Promise<T> {
    const document = toMongoDocumentWithPartialId(entity);
    const result = await this.collection.insertOne(document as MongoDocument<T>);

    const entityCopy = (entity.id != undefined)
      ? { ...(entity as T) }
      : { ...(entity as T), id: objectIdOrStringToString(result.insertedId) };

    return entityCopy;
  }

  async replace(entity: EntityWithPartialId<T>, upsert: boolean): Promise<T> {
    const savedEntities = await this.replaceMany([entity], upsert);
    return SyncEnumerable.from(savedEntities).single();
  }

  async insertMany(entities: EntityWithPartialId<T>[]): Promise<T[]> {
    if (entities.length == 0) {
      return [];
    }

    const operations = entities.map(toInsertOneOperation);
    const bulkWriteResult = await this.collection.bulkWrite(operations);
    const insertedIds = bulkWriteResult.insertedIds as IdsMap;
    const savedEntities = entities.map((entity, index) => {
      const entityCopy = { ...entity };

      const hasInsertedId = insertedIds.hasOwnProperty(index);

      if (hasInsertedId) {
        entityCopy.id = objectIdOrStringToString(insertedIds[index] as any as Mongo.ObjectId);
      }

      return entityCopy as T;
    });

    return savedEntities;
  }

  async replaceMany(entities: EntityWithPartialId<T>[], upsert: boolean): Promise<T[]> {
    if (entities.length == 0) {
      return [];
    }

    const operations = entities.map((entity) => toReplaceOneOperation(entity, upsert));
    const bulkWriteResult = await this.collection.bulkWrite(operations);
    const upsertedIds = bulkWriteResult.upsertedIds as IdsMap;
    const savedEntities = entities.map((entity, index) => {
      const entityCopy = { ...entity };

      const hasUpsertedId = upsertedIds.hasOwnProperty(index);
      if (hasUpsertedId) {
        entityCopy.id = objectIdOrStringToString(upsertedIds[index]._id);
      }

      return entityCopy as T;
    });

    return savedEntities;
  }

  async load(id: string, throwIfNotFound?: true): Promise<T>;
  async load(id: string, throwIfNotFound: boolean): Promise<T | undefined>;
  async load(id: string, throwIfNotFound: boolean = true): Promise<T | undefined> {
    const filter = {
      _id: stringToObjectIdOrString(id)
    };

    return this.loadByFilter(filter, throwIfNotFound);
  }

  async loadByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>, throwIfNotFound?: true): Promise<T>;
  async loadByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>, throwIfNotFound: boolean): Promise<T | undefined>;
  async loadByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>, throwIfNotFound: boolean = true): Promise<T | undefined> {
    const document = await this.collection.findOne(filter);

    if (document == undefined) {
      if (throwIfNotFound) {
        throw new Error('document not found');
      }

      return undefined;
    }

    const entity = toEntity(document);
    return entity;
  }

  async *loadManyById(ids: string[]): AsyncIterableIterator<T> {
    const normalizedIds = ids.map(stringToObjectIdOrString);

    const filter: Mongo.FilterQuery<MongoDocument<T>> = {
      _id: { $in: normalizedIds }
    };

    yield* this.loadManyByFilter(filter);
  }

  async *loadManyByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>): AsyncIterableIterator<T> {
    const cursor = this.collection.find<MongoDocument<T>>(filter);

    while (true) {
      const document = await cursor.next();

      if (document == undefined) {
        break;
      }

      const entity = toEntity(document);
      yield entity;
    }
  }

  async countByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>): Promise<number> {
    return this.collection.countDocuments(filter);
  }

  async hasByFilter(filter: Mongo.FilterQuery<MongoDocument<T>>): Promise<boolean> {
    const count = await this.countByFilter(filter);
    return count > 0;
  }

  async has(id: string): Promise<boolean> {
    const filter = { _id: stringToObjectIdOrString(id) };
    return this.hasByFilter(filter);
  }

  async hasMany(ids: string[]): Promise<string[]> {
    const normalizedIds = ids.map(stringToObjectIdOrString);

    const filter: Mongo.FilterQuery<MongoDocument<T>> = {
      _id: { $in: normalizedIds }
    };

    const result = await this.collection.distinct('_id', filter) as string[];
    return result;
  }

  async drop(): Promise<void> {
    await this.collection.drop();
  }
}

function toInsertOneOperation<T extends Entity>(entity: EntityWithPartialId<T>): object {
  const document = toMongoDocumentWithPartialId(entity);

  const operation = {
    insertOne: {
      document
    }
  };

  return operation;
}

function toReplaceOneOperation<T extends Entity>(entity: EntityWithPartialId<T>, upsert: boolean): object {
  const filter: Mongo.FilterQuery<MongoDocument<T>> = {};

  if (entity.id != undefined) {
    filter._id = entity.id;
  }

  const replacement = toMongoDocumentWithPartialId(entity);

  const operation = {
    replaceOne: {
      filter,
      replacement,
      upsert
    }
  };

  return operation;
}
