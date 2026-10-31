# wpilib-struct

Parse WPILib struct schemas and decode binary struct payloads in TypeScript & JavaScript.

## Install

```sh
npm install wpilib-struct
```

## Usage

```ts
import { StructRegistry } from 'wpilib-struct';

const registry = new StructRegistry();
registry.register('Translation2d', 'double x;double y');

const bytes = new Uint8Array(16);
const view = new DataView(bytes.buffer);
view.setFloat64(0, 1.5, true);
view.setFloat64(8, 2.5, true);

console.log(registry.decode('Translation2d', bytes));
// { x: 1.5, y: 2.5 }
```

`decode()` returns a plain object, including nested structs and arrays. 64-bit integers are returned as `bigint` values.
Use `decodeArray()` to decode an array of structs, passing the base schema name without a `[]` suffix.

Schemas can be registered in any order. If a schema is missing, decoding returns its name instead of a decoded value.

Reuse a registry for repeated decoding. Schemas are compiled lazily into reusable decoders.
In environments where Content Security Policy blocks runtime code generation, structs are decoded by the interpreter automatically.

A summary of the full API is available in [wpilib-struct.api.md](https://github.com/jonahsnider/wpilog-parser/blob/main/packages/wpilib-struct/etc/wpilib-struct.api.md).
