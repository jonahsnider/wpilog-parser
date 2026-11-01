# wpilib-struct

Parse WPILib struct schemas and encode/decode binary struct payloads in TypeScript & JavaScript.

## Install

```sh
npm install wpilib-struct
```

## Usage

```ts
import { StructRegistry } from 'wpilib-struct';

const registry = new StructRegistry();
registry.register('Translation2d', 'double x;double y');

const bytes = registry.encode('Translation2d', { x: 1.5, y: 2.5 });
console.log(registry.decode('Translation2d', bytes));
// { x: 1.5, y: 2.5 }
```

`decode()` returns a plain object, including nested structs and arrays. 64-bit integers are returned as `bigint` values.
Use `decodeArray()` / `encodeArray()` for contiguous arrays of structs, passing the base schema name without a `[]` suffix.
`encode()` / `encodeInto()` pack the same layouts that decode reads; `char` fields are strings (UTF-8, truncated/padded to width).

Schemas can be registered in any order. If a schema is missing, encode and decode return its name instead of a value.

Reuse a registry for repeated decoding. Schemas are compiled lazily into reusable decoders.
In environments where Content Security Policy blocks runtime code generation, structs are decoded by the interpreter automatically.
Encoding currently uses the interpreter only.

A summary of the full API is available in [wpilib-struct.api.md](https://github.com/jonahsnider/wpilog-parser/blob/main/packages/wpilib-struct/etc/wpilib-struct.api.md).
