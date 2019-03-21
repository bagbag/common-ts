import { NumberMap } from '@common-ts/base/types';
import { ObjectId } from 'mongodb';

export type IdsMap = NumberMap<{ _id: ObjectId }>;

export function objectIdOrStringToString(id: string | ObjectId): string {
  if (typeof id == 'string') {
    return id;
  }

  return id.toHexString();
}

export function stringToObjectIdOrString(id: string): string | ObjectId {
  const valid = ObjectId.isValid(id);

  if (valid) {
    return ObjectId.createFromHexString(id);
  }

  return id;
}
