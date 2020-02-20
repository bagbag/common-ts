import { now } from '@tstdl/base/utils';
import { EntityRepository } from '@tstdl/database';
import { MongoError } from 'mongodb';
import { MongoEntityRepository } from '../entity-repository';
import { getNewDocumentId } from '../id';
import { Collection, FilterQuery, TypedIndexSpecification } from '../types';
import { LockEntity } from './model';

const indexes: TypedIndexSpecification<LockEntity>[] = [
  { key: { ressource: 1 }, unique: true },
  { key: { expire: 1 }, expireAfterSeconds: 1 }
];

export class MongoLockRepository extends MongoEntityRepository<LockEntity> implements EntityRepository<LockEntity> {
  constructor(collection: Collection<LockEntity>) {
    super(collection, { indexes });
  }

  async tryInsertOrRefresh(ressource: string, key: string, newExpirationDate: Date): Promise<false | Date> {
    const filter: FilterQuery<LockEntity> = {
      $and: [
        { ressource },
        {
          $or: [
            { key },
            { expire: { $lte: now() } }
          ]
        }
      ]
    };

    try {
      const { upsertedCount, modifiedCount } = await this.baseRepository.update(filter, { $set: { expire: newExpirationDate }, $setOnInsert: { _id: getNewDocumentId(), key } }, true);
      return (upsertedCount > 0 || modifiedCount > 0) ? newExpirationDate : false;
    }
    catch (error) {
      if (error instanceof MongoError && error.code == 11000) {
        return false;
      }

      throw error;
    }
  }

  async exists(ressource: string): Promise<boolean> {
    return this.baseRepository.hasByFilter({ ressource, expire: { $gt: now() } });
  }

  async tryUpdateExpiration(ressource: string, key: string, expirationDate: Date): Promise<false | Date> {
    const filter: FilterQuery<LockEntity> = { ressource, key };
    const result = await this.baseRepository.update(filter, { $set: { expire: expirationDate } });
    return result.modifiedCount > 0 ? expirationDate : false;
  }

  async deleteByRessource(ressource: string, key: string): Promise<boolean> {
    return this.baseRepository.deleteByFilter({ ressource, key });
  }
}
