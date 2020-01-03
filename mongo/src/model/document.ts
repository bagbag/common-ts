import { Omit } from '@tstdl/base/types';
import { getRandomString } from '@tstdl/base/utils';
import { Entity, EntityWithPartialId } from '@tstdl/database';

export type MongoDocument<T extends EntityWithPartialId> = Omit<T, 'id'> & {
  _id: string;
};

export type MongoDocumentWitPartialId<T extends EntityWithPartialId> = Omit<T, 'id'> & {
  _id?: string;
};

export function toEntity<T extends Entity>(document: MongoDocument<T>): T {
  const { _id, ...entityRest } = document;

  const entity: T = {
    id: _id,
    ...entityRest
  } as any as T;

  return entity;
}

export function toMongoDocument<T extends Entity>(entity: T): MongoDocument<T> {
  const { id, ...entityRest } = entity;

  const document: MongoDocument<T> = {
    _id: entity.id,
    ...entityRest
  };

  return document;
}

export function toMongoDocumentWithPartialId<T extends EntityWithPartialId>(entity: T): MongoDocumentWitPartialId<T> {
  const { id, ...entityRest } = entity;

  const partialIdObject = (id != undefined) ? { _id: id } : {};

  const document = {
    ...partialIdObject,
    ...entityRest
  };

  return document;
}

export function toMongoDocumentWithNewId<T extends Entity>(entity: EntityWithPartialId<T>): MongoDocument<T> {
  const { id, ...entityRest } = entity;

  // tslint:disable-next-line: no-object-literal-type-assertion
  const document = {
    _id: (id != undefined) ? id : getRandomString(15),
    ...entityRest
  } as MongoDocument<T>;

  return document;
}