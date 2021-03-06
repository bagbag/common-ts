import type { RangeQuery, TextQueryType } from '@elastic/elasticsearch/api/types';
import { isPrimitive } from '#/utils';
import type { Entity } from '#/database';
import type { ComparisonEqualsQuery, ComparisonGreaterThanOrEqualsQuery, ComparisonGreaterThanQuery, ComparisonInQuery, ComparisonLessThanOrEqualsQuery, ComparisonLessThanQuery, ComparisonNotEqualsQuery, ComparisonNotInQuery, ComparisonRegexQuery, ComparisonTextQuery, ComplexTextSpanQuery, ComplexTextSpanQueryMode, LogicalAndQuery, LogicalNorQuery, LogicalOrQuery, Query } from '#/database/query';
import type { ElasticMatchQuery, ElasticMultiMatchQuery, ElasticQuery, ElasticRangeQuery, ElasticRegexQuery, ElasticTermQuery, ElasticTermsQuery } from './model';
import { BoolQueryBuilder } from './query-builder';

// eslint-disable-next-line max-lines-per-function, max-statements, complexity
export function convertQuery<T extends Entity>(query: Query<T>): ElasticQuery {
  const defaultBoolQueryBuilder = new BoolQueryBuilder();

  const queryEntries = Object.entries(query);

  // eslint-disable-next-line no-unreachable-loop
  for (const [rawProperty, value] of queryEntries) {
    const property = getPropertyName(rawProperty);
    const isPrimitiveValue = isPrimitive(value);
    const range: RangeQuery = {};

    let canHandleProperty = false;

    if (rawProperty == '$and') {
      if (queryEntries.length > 1) {
        throw new Error('only one logical operator per level allowed');
      }

      return convertLogicalAndQuery((value as LogicalAndQuery['$and']));
    }

    if (rawProperty == '$or') {
      if (queryEntries.length > 1) {
        throw new Error('only one logical operator per level allowed');
      }

      return convertLogicalOrQuery((value as LogicalOrQuery['$or']));
    }

    if (rawProperty == '$nor') {
      if (queryEntries.length > 1) {
        throw new Error('only one logical operator per level allowed');
      }

      return convertLogicalNorQuery((value as LogicalNorQuery['$nor']));
    }

    if (rawProperty == '$textSpan') {
      const { fields, text, mode, operator } = value as ComplexTextSpanQuery['$textSpan'];
      const type = convertComplexTextSpanQueryMode(mode);
      const matchQuery: ElasticMultiMatchQuery = { multi_match: { fields, query: text, type, operator } };

      defaultBoolQueryBuilder.must(matchQuery);
      canHandleProperty = true;
    }

    if (isPrimitiveValue || Object.prototype.hasOwnProperty.call(value, '$eq')) {
      const termQuery: ElasticTermQuery = {
        term: { [property]: isPrimitiveValue ? value : (value as ComparisonEqualsQuery).$eq }
      };

      defaultBoolQueryBuilder.must(termQuery);
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$neq')) {
      const termQuery: ElasticTermQuery = {
        term: { [property]: (value as ComparisonNotEqualsQuery).$neq }
      };

      defaultBoolQueryBuilder.mustNot(termQuery);
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$in')) {
      const termQuery: ElasticTermsQuery = {
        terms: { [property]: (value as ComparisonInQuery).$in }
      };

      defaultBoolQueryBuilder.must(termQuery);
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$nin')) {
      const termQuery: ElasticTermsQuery = {
        terms: { [property]: (value as ComparisonNotInQuery).$nin }
      };

      defaultBoolQueryBuilder.mustNot(termQuery);
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$lt')) {
      range.lt = (value as ComparisonLessThanQuery).$lt;
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$lte')) {
      range.lte = (value as ComparisonLessThanOrEqualsQuery).$lte;
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$gt')) {
      range.gt = (value as ComparisonGreaterThanQuery).$gt;
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$gte')) {
      range.gte = (value as ComparisonGreaterThanOrEqualsQuery).$gte;
      canHandleProperty = true;
    }

    if (Object.values(range).length > 0) {
      const rangeQuery: ElasticRangeQuery = { range: { [property]: range } };
      defaultBoolQueryBuilder.must(rangeQuery);
    }

    if (Object.prototype.hasOwnProperty.call(value, '$regex')) {
      const termQuery: ElasticRegexQuery = {
        regexp: { [property]: (value as ComparisonRegexQuery).$regex }
      };

      defaultBoolQueryBuilder.must(termQuery);
      canHandleProperty = true;
    }

    if (Object.prototype.hasOwnProperty.call(value, '$text')) {
      let matchQuery: ElasticMatchQuery;
      const textQueryValue = (value as ComparisonTextQuery).$text;

      if (typeof textQueryValue == 'string') {
        matchQuery = { match: { [property]: { query: textQueryValue } } };
      }
      else {
        matchQuery = { match: { [property]: { query: textQueryValue.text, operator: textQueryValue.operator } } };
      }

      defaultBoolQueryBuilder.must(matchQuery);
      canHandleProperty = true;
    }

    if (!canHandleProperty) {
      throw new Error(`unsupported query type "${rawProperty}"`);
    }
  }

  if (defaultBoolQueryBuilder.totalQueries == 0) {
    return { match_all: {} };
  }

  return defaultBoolQueryBuilder.build();
}

function getPropertyName(property: string): string {
  return property == 'id' ? '_id' : property;
}

export function convertLogicalAndQuery<T extends Entity>(andQuery: LogicalAndQuery<T>['$and']): ElasticQuery {
  return new BoolQueryBuilder().must(...andQuery.map(convertQuery)).build();
}

export function convertLogicalOrQuery<T extends Entity>(orQuery: LogicalOrQuery<T>['$or']): ElasticQuery {
  return new BoolQueryBuilder().should(...orQuery.map(convertQuery)).build();
}

export function convertLogicalNorQuery<T extends Entity>(norQuery: LogicalNorQuery<T>['$nor']): ElasticQuery {
  return new BoolQueryBuilder().mustNot(...norQuery.map(convertQuery)).build();
}

export function convertComplexTextSpanQueryMode(mode: ComplexTextSpanQueryMode | undefined): TextQueryType | undefined {
  switch (mode) {
    case undefined:
      return undefined;

    case 'best':
      return 'best_fields';

    case 'most':
      return 'most_fields';

    case 'cross':
      return 'cross_fields';

    default:
      throw new Error('unknown ComplexTextSpanQueryMode');
  }
}
