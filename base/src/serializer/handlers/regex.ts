import { SerializeHandler } from '../serialize-handler';
import { SerializedElement } from '../serialized-element';

const TYPE = 'regexp';

type SerializedRegexData = {
  pattern: string,
  flags: string
};

export class RegexSerializeHandler implements SerializeHandler {
  canSerialize(obj: any): boolean {
    return obj.constructor == RegExp;
  }

  serialize(obj: any): SerializedElement {
    const data: SerializedRegexData = {
      pattern: (obj as RegExp).source,
      flags: (obj as RegExp).flags
    };

    return {
      type: TYPE,
      data
    };
  }

  canDeserialize(serialized: SerializedElement): boolean {
    return serialized.type == TYPE;
  }

  deserialize(serialized: SerializedElement): any {
    const data = (serialized.data as SerializedRegexData);
    return new RegExp(data.pattern, data.flags);
  }
}
