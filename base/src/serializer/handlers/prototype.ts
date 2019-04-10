import { deserialize, Serializable, SerializableStatic, serialize } from '../serializable';
import { SerializeHandler } from '../serialize-handler';
import { SerializedElement } from '../serialized-element';
import { Serializer } from '../serializer';

type SerializedInstanceData = {
  prototype: string;
  data: any;
};

type SerializedInstance = SerializedElement<SerializedInstanceData>;

const TYPE = 'prototype';

function isSerializedInstance(serializedElement: SerializedElement): serializedElement is SerializedInstance {
  return serializedElement.type == TYPE;
}

export class PrototypeSerializeHandler implements SerializeHandler {
  private readonly prototypes: Map<string, SerializableStatic>;

  constructor() {
    this.prototypes = new Map();
  }

  register(prototype: SerializableStatic): void {
    this.prototypes.set(prototype.name, prototype);
  }

  canSerialize(obj: any): boolean {
    // tslint:disable-next-line: no-unbound-method
    return typeof (obj as Serializable)[serialize] == 'function';
  }

  serialize(obj: any): SerializedInstance {
    const instance = obj as Serializable;

    const data = instance[serialize]();
    const serializedData = Serializer.rawSerialize(data);

    const serializedInstanceData: SerializedInstanceData = {
      prototype: instance.constructor.name,
      data: serializedData
    };

    return {
      type: TYPE,
      data: serializedInstanceData
    };
  }

  canDeserialize(serializedElement: SerializedElement): boolean {
    if (isSerializedInstance(serializedElement)) {
      return this.prototypes.has(serializedElement.data.prototype);
    }

    return false;
  }

  deserialize(serializedInstance: SerializedInstance): any {
    const serializedInstanceData = serializedInstance.data;
    const prototype = this.prototypes.get(serializedInstanceData.prototype);

    if (prototype == undefined) {
      throw new Error(`no prototype named ${serializedInstanceData.prototype} registered`);
    }

    // tslint:disable-next-line: no-unsafe-any
    const deserializedData = Serializer.deserialize(serializedInstanceData.data);
    const instance = prototype[deserialize](deserializedData);

    return instance;
  }
}
