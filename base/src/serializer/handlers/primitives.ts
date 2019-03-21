import { SerializeHandler } from '../serialize-handler';
import { SerializedElement } from '../serialized-element';

const TYPE = 'primitive';

export class PrimitivesSerializeHandler implements SerializeHandler {
  canSerialize(obj: any): boolean {
    const type = typeof obj;
    return obj == undefined || type == 'string' || type == 'number' || type == 'boolean';
  }

  serialize(obj: any): SerializedElement {
    return {
      type: TYPE,
      data: obj
    };
  }

  canDeserialize(serialized: SerializedElement): boolean {
    return serialized.type == TYPE;
  }

  deserialize(serialized: SerializedElement): any {
    return serialized.data;
  }
}
