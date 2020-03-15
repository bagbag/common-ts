/* eslint-disable @typescript-eslint/member-delimiter-style */
import { Enumerable } from '@tstdl/base/enumerable';
import { StringMap } from '@tstdl/base/types';
import { Redis } from 'ioredis';
import { Consumer, ConsumerGroup, Entry, PendingEntry, PendingInfo, SourceEntry, StreamInfo } from './model';

export type ReadParameters = {
  id: string,
  count?: number,
  block?: number
};

export type ReadGroupParameters = {
  id: string,
  group: string,
  consumer: string,
  count?: number,
  block?: number,
  noAck?: boolean
};

export type GetPendingInfoParameters = {
  group: string,
  consumer?: string,
};

export type GetPendingEntriesParameters = GetPendingInfoParameters & {
  start: string,
  end: string,
  count: number
};

export type ClaimParameters = {
  group: string,
  consumer: string,
  minimumIdleTime: number,
  ids: string[]
};

type EntryReturnValue = [string, string[]];

type EntriesReturnValue = EntryReturnValue[];

type ReadReturnValue = [string, EntriesReturnValue][];

type PendingConsumerValue = [string, string][];

type PendingReturnValue = [0, null, null, null] | [number, string, string, PendingConsumerValue];

type InfoReturnValue = (string | number | EntryReturnValue)[];

export class RedisStream<T extends StringMap<string>> {
  private readonly redis: Redis;
  private readonly stream: string;

  constructor(redis: Redis, stream: string) {
    this.redis = redis;
    this.stream = stream;
  }

  async add(entry: SourceEntry<T>): Promise<string> {
    const { id: sourceId, data } = entry;
    const parameters = buildFieldValueArray(data);

    const id = await this.redis.xadd(this.stream, (sourceId != undefined) ? sourceId : '*', ...parameters);
    return id;
  }

  async addMany(entries: SourceEntry<T>[]): Promise<string[]> {
    const transaction = this.redis.multi();

    for (const entry of entries) {
      const { id: sourceId, data } = entry;
      const parameters = buildFieldValueArray(data);

      transaction.xadd(this.stream, (sourceId != undefined) ? sourceId : '*', ...parameters);
    }

    const results = await transaction.exec() as [Error | null, string][];
    const ids = results.map(([, id]) => id);

    return ids;
  }

  async range(start: string, end: string, count?: number): Promise<Entry<T>[]> {
    const parameters = [this.stream, start, end, ...(count != undefined ? [count] : [])] as [string, string, string, number];

    const range = await this.redis.xrange(...parameters);
    const entries = parseEntriesReturnValue<T>(range);

    return entries;
  }

  async get(id: string): Promise<Entry<T> | undefined> {
    const result = await this.redis.xrange(this.stream, id, id, 'COUNT', '1');
    const entries = parseEntriesReturnValue<T>(result);

    return entries[0];
  }

  async getMany(ids: string[]): Promise<Entry<T>[]> {
    if (ids.length == 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();

    for (const id of ids) {
      pipeline.xrange(this.stream, id, id, 'COUNT', '1');
    }

    const result = await pipeline.exec() as [Error | null, EntriesReturnValue][];

    let entries: Entry<T>[] = [];

    for (const [error, value] of result) {
      if (error != undefined) {
        throw error;
      }

      const parsedEntries = parseEntriesReturnValue<T>(value);
      entries = [...entries, ...parsedEntries];
    }

    return entries;
  }

  async acknowledgeDeleteTransaction(group: string, ids: string[]): Promise<void> {
    if (ids.length == 0) {
      throw new Error('empty ids array');
    }

    const transaction = this.redis.multi();

    transaction.xack(this.stream, group, ...ids);
    transaction.xdel(this.stream, ...ids);

    await transaction.exec();
  }

  async acknowledgeDeleteAddTransaction(group: string, acknowledgeDeleteIds: string[], entries: SourceEntry<T>[]): Promise<string[]> {
    if (acknowledgeDeleteIds.length == 0) {
      throw new Error('empty acknowledgeDeleteIds array');
    }
    if (entries.length == 0) {
      throw new Error('empty entries array');
    }

    const transaction = this.redis.multi();

    transaction.xack(this.stream, group, ...acknowledgeDeleteIds);
    transaction.xdel(this.stream, ...acknowledgeDeleteIds);

    for (const entry of entries) {
      const { id, data } = entry;
      const parameters = buildFieldValueArray(data);

      transaction.xadd(this.stream, (id != undefined) ? id : '*', ...parameters);
    }

    const results = await transaction.exec() as [[Error | null, number], ...[Error | null, string][]];
    const [acknowledgeResult, deleteResult, ...addResults] = results; // eslint-disable-line @typescript-eslint/no-unused-vars

    const newIds = addResults.map(([, id]) => id);
    return newIds;
  }

  async read({ id, block, count }: ReadParameters): Promise<Entry<T>[]> {
    const parametersArray = [
      ...(count != undefined ? ['COUNT', count] : []),
      ...(block != undefined ? ['BLOCK', block] : []),
      'STREAMS',
      this.stream,
      id
    ];

    const data = await (this.redis.xread(...parametersArray) as any as Promise<ReadReturnValue>);
    const entries = parseReadReturnValue<T>(data);

    return entries;
  }

  async readGroup({ id, group, consumer, count, block, noAck }: ReadGroupParameters): Promise<Entry<T>[]> {
    const parametersArray = [
      'GROUP',
      group,
      consumer,
      ...(count != undefined ? ['COUNT', count] : []),
      ...(block != undefined ? ['BLOCK', block] : []),
      ...(noAck != undefined ? ['NOACK'] : []),
      'STREAMS',
      this.stream,
      id
    ] as ['GROUP', string, string, ...string[]];

    const data = await this.redis.xreadgroup(...parametersArray) as ReadReturnValue;

    if (data == undefined) {
      return [];
    }

    const entries = parseReadReturnValue<T>(data);

    return entries;
  }

  async delete(...ids: string[]): Promise<number> {
    const acknowledgedCount = await this.redis.xdel(this.stream, ...ids);
    return acknowledgedCount;
  }

  async acknowledge(group: string, ...ids: string[]): Promise<number> {
    const acknowledgedCount = await this.redis.xack(this.stream, group, ...ids);
    return acknowledgedCount;
  }

  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: false): Promise<Entry<T>[]>;
  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: true): Promise<string[]>;
  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: boolean): Promise<string[] | Entry<T>[]> {
    if (idsOnly) {
      const claimedIds = await this.redis.xclaim(this.stream, group, consumer, minimumIdleTime, ...ids, 'JUSTID') as any as string[];
      return claimedIds;
    }

    const claimedEntries = await this.redis.xclaim(this.stream, group, consumer, minimumIdleTime, ...ids) as EntriesReturnValue;
    const entries = parseEntriesReturnValue<T>(claimedEntries);

    return entries;
  }

  async trim(maxLength: number, approximate: boolean): Promise<number> {
    const trimmedCount = await this.redis.xtrim(this.stream, 'MAXLEN', ...(approximate ? ['~'] : []), maxLength);
    return trimmedCount;
  }

  async info(): Promise<StreamInfo<T>> {
    const info = await this.redis.xinfo('STREAM', this.stream) as InfoReturnValue;
    const streamInfo = parseInfoReturnValue<T>(info);

    return streamInfo;
  }

  async exists(): Promise<boolean> {
    const type = await this.redis.type(this.stream);
    return type == 'stream';
  }

  async hasGroup(name: string): Promise<boolean> {
    const exists = await this.exists();

    if (!exists) {
      return false;
    }

    const groups = await this.getGroups();
    return groups.some((group) => group.name == name);
  }

  async getGroups(): Promise<ConsumerGroup[]> {
    const info = await this.redis.xinfo('GROUPS', this.stream) as (string | number)[][];
    const groups = info.map((groupInfo) => parseGroupInfo(groupInfo));

    return groups;
  }

  async getConsumers(group: string): Promise<Consumer[]> {
    const info = await this.redis.xinfo('CONSUMERS', this.stream, group) as (string | number)[][];
    const consumers = info.map((consumerInfo) => parseConsumer(consumerInfo));

    return consumers;
  }

  async deleteConsumer(group: string, consumer: string): Promise<number> {
    const pendingMessages = await this.redis.xgroup('DELCONSUMER', this.stream, group, consumer) as any as number;
    return pendingMessages;
  }

  async getPendingInfo(group: string): Promise<PendingInfo>;
  async getPendingInfo(group: string): Promise<PendingInfo>;
  async getPendingInfo(group: string): Promise<PendingInfo> {
    const [count, firstId, lastId, pendingConsumerInfo] = await this.redis.xpending(this.stream, group) as PendingReturnValue;

    const consumers
      = (pendingConsumerInfo == undefined)
        ? []
        : pendingConsumerInfo.map(([name, count]) => ({ name, count: parseInt(count, 10) })); // eslint-disable-line no-shadow

    const pendingInfo: PendingInfo = {
      count,
      firstId,
      lastId,
      consumers
    };

    return pendingInfo;
  }

  async getPendingEntries({ group, consumer, start, end, count }: GetPendingEntriesParameters): Promise<PendingEntry[]> {
    const pending = await this.redis.xpending(this.stream, group, start, end, count, ...(consumer != undefined ? [consumer] : [])) as [string, string, number, number][];
    const pendingEntries: PendingEntry[] = pending.map(([id, consumerName, elapsed, deliveryCount]) => ({ id, consumer: consumerName, elapsed, deliveryCount }));

    return pendingEntries;
  }

  async createGroup(group: string, makeStream?: boolean): Promise<void>;
  async createGroup(group: string, startAtId: '0' | '$' | string, makeStream?: boolean): Promise<void>;
  async createGroup(group: string, startAtIdOrMakeStream?: '0' | '$' | string | boolean, mkStream: boolean = false): Promise<void> {
    const startAtId = (typeof startAtIdOrMakeStream == 'string') ? startAtIdOrMakeStream : '0';
    const makeStream = (typeof startAtIdOrMakeStream == 'boolean') ? startAtIdOrMakeStream : mkStream;

    await this.redis.xgroup('CREATE', this.stream, group, startAtId, ...(makeStream ? ['MKSTREAM'] : []));
  }
}

function buildFieldValueArray(data: StringMap<string>): string[] {
  const parameters: string[] = [];
  const fields = Object.keys(data);

  for (const field of fields) {
    parameters.push(field, data[field]);
  }

  return parameters;
}

function parseReadReturnValue<T>(data: ReadReturnValue): Entry<T>[] {
  const entries = Enumerable.from(data)
    .mapMany(([_stream, items]) => items)
    .map((entry) => parseEntryReturnValue<T>(entry))
    .toArray();

  return entries;
}

function parseInfoReturnValue<T>(info: InfoReturnValue): StreamInfo<T> {
  const consumerGroup: StreamInfo<T> = {} as any;

  for (let i = 0; i < info.length; i += 2) {
    switch (info[i]) {
      case 'length':
        consumerGroup.length = info[i + 1] as number;
        break;

      case 'radix-tree-keys':
        consumerGroup.radixTreeKeys = info[i + 1] as number;
        break;

      case 'radix-tree-nodes':
        consumerGroup.radixTreeNodes = info[i + 1] as number;
        break;

      case 'groups':
        consumerGroup.groups = info[i + 1] as number;
        break;

      case 'first-entry':
        consumerGroup.firstEntry = parseEntryReturnValue(info[i + 1] as EntryReturnValue);
        break;

      case 'last-entry':
        consumerGroup.lastEntry = parseEntryReturnValue(info[i + 1] as EntryReturnValue);
        break;

      default:
        break;
    }
  }

  return consumerGroup;
}

function parseEntriesReturnValue<T>(items: EntriesReturnValue): Entry<T>[] {
  const entries = items.map((item) => parseEntryReturnValue<T>(item));
  return entries;
}

function parseEntryReturnValue<T>([id, dataArray]: EntryReturnValue): Entry<T> {
  const entry: Entry<T> = { id, data: {} } as any;

  for (let i = 0; i < dataArray.length; i += 2) {
    const field = dataArray[i];
    const value = dataArray[i + 1];

    (entry.data as StringMap)[field] = value;
  }

  return entry;
}

function parseGroupInfo(info: (string | number)[]): ConsumerGroup {
  const consumerGroup: ConsumerGroup = {} as any;

  for (let i = 0; i < info.length; i += 2) {
    switch (info[i]) {
      case 'name':
        consumerGroup.name = info[i + 1] as string;
        break;

      case 'consumers':
        consumerGroup.consumers = info[i + 1] as number;
        break;

      case 'pending':
        consumerGroup.pending = info[i + 1] as number;
        break;

      default:
        break;
    }
  }

  return consumerGroup;
}

function parseConsumer(info: (string | number)[]): Consumer {
  const consumer: Consumer = {} as any;

  for (let i = 0; i < info.length; i += 2) {
    switch (info[i]) {
      case 'name':
        consumer.name = info[i + 1] as string;
        break;

      case 'pending':
        consumer.pending = info[i + 1] as number;
        break;

      case 'idle':
        consumer.idle = info[i + 1] as number;
        break;

      default:
        break;
    }
  }

  return consumer;
}
