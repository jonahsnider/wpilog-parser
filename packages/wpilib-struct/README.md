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

### Encoding

```ts
const bytes = registry.encode('Translation2d', { x: 1.5, y: 2.5 });
```

`encode()` returns a new `Uint8Array`, and `encodeArray()` encodes an array of structs. `encodeInto()` writes into an existing buffer at a byte offset and returns the number of bytes written.
Like decoding, encoding returns the name of a missing schema instead of bytes.

Integer fields accept a `number` (safe integers only) or a `bigint`. `char` fields take a string that must fit in the field as UTF-8; shorter strings are padded with zero bytes.
Values that are missing, have the wrong type, or are out of range for their field or bit-field width throw a `TypeError` or `RangeError`. Fields not in the schema are ignored.

Reuse a registry for repeated decoding and encoding. Schemas are compiled lazily into reusable decoders and encoders.
In environments where Content Security Policy blocks runtime code generation, both fall back to a CSP-safe implementation.

A summary of the full API is available in [wpilib-struct.api.md](https://github.com/jonahsnider/wpilog-parser/blob/main/packages/wpilib-struct/etc/wpilib-struct.api.md).
