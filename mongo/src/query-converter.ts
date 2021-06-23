import { isDefined, isObject, isPrimitive } from '@tstdl/base/utils';
import type { Entity } from '@tstdl/database';
import type { LogicalAndQuery, LogicalNorQuery, LogicalOrQuery, Query, Sort } from '@tstdl/database/query';
import { allComparisonQueryTypes } from '@tstdl/database/query';
import type { SortArrayItem } from './mongo-base.repository';
import type { TransformerMappingMap } from './mongo-entity-repository';
import type { FilterQuery } from './types';

export function convertQuery<T extends Entity, TDb extends Entity>(query: Query<T>, mappingMap: TransformerMappingMap<T, TDb>): FilterQuery<TDb> {
  const filterQuery: FilterQuery<any> = {};

  for (const [rawProperty, rawValue] of Object.entries(query)) {
    const mapping = mappingMap.get(rawProperty as keyof T);

    const property = isDefined(mapping) ? getPropertyName(mapping.key as string) : getPropertyName(rawProperty);
    const value = isDefined(mapping) ? mapping.transform(rawValue) : rawValue;

    const newProperty = getPropertyName(property);
    const isPrimitiveValue = isPrimitive(value);

    if (isPrimitiveValue) {
      filterQuery[newProperty] = value;
    }
    else if (property == '$and') {
      filterQuery.$and = convertLogicalAndQuery(value, mappingMap);
    }
    else if (property == '$or') {
      filterQuery.$or = convertLogicalOrQuery(value, mappingMap);
    }
    else if (property == '$nor') {
      filterQuery.$nor = convertLogicalNorQuery(value, mappingMap);
    }
    else if ((allComparisonQueryTypes as string[]).includes(property)) {
      filterQuery[newProperty] = value;
    }
    else if (isObject(value)) {
      filterQuery[newProperty] = convertQuery(value, mappingMap);
    }
    else {
      throw new Error(`unsupported query property ${property}`);
    }
  }

  return filterQuery;
}

function getPropertyName(property: string): string {
  return property == 'id' ? '_id' : property;
}

export function convertLogicalAndQuery<T extends Entity>(andQuery: LogicalAndQuery<T>, mapping: TransformerMappingMap<T, any>): FilterQuery<T>[] {
  return andQuery.$and.map((query) => convertQuery(query, mapping));
}

export function convertLogicalOrQuery<T extends Entity>(orQuery: LogicalOrQuery<T>, mapping: TransformerMappingMap<T, any>): FilterQuery<T>[] {
  return orQuery.$or.map((query) => convertQuery(query, mapping));
}

export function convertLogicalNorQuery<T extends Entity>(norQuery: LogicalNorQuery<T>, mapping: TransformerMappingMap<T, any>): FilterQuery<T>[] {
  return norQuery.$nor.map((query) => convertQuery(query, mapping));
}

export function convertSort<T extends Entity, TDb extends Entity>(sort: Sort<T>, mappingMap: TransformerMappingMap<T, TDb>): SortArrayItem<TDb> {
  const field = mappingMap.get(sort.field as keyof T)?.key ?? sort.field;
  return [field, sort.order == 'desc' ? -1 : 1] as SortArrayItem<TDb>;
}
