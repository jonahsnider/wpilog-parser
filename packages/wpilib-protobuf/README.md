# wpilib-protobuf

Decode WPILib protobuf values in TypeScript & JavaScript, from the schemas WPILib logs and publishes to NetworkTables.

## Install

```sh
npm install wpilib-protobuf
```

## Usage

WPILib sends a schema for every `.proto` file a protobuf value uses, as `/.schema/proto:<file>` entries holding a serialized `google.protobuf.FileDescriptorProto`.
Register each one, then decode values by the message name from their type, ex. `wpi.proto.ProtobufPose2d` for a `proto:wpi.proto.ProtobufPose2d` entry:

```ts
import { ProtobufRegistry } from 'wpilib-protobuf';

const registry = new ProtobufRegistry();
registry.register(geometry2dSchema);

console.log(registry.decode('wpi.proto.ProtobufPose2d', bytes));
// { translation: { x: 1.5, y: -2 }, rotation: { value: 3 } }
```

`decode()` returns a plain object with fields named as declared in the schema. WPILib's messages use the same field names as its structs.

- Fields without presence tracking, like most proto3 scalars, always have a value, their default when not set.
- Unset message fields, `optional` fields, and oneof members are left out.
- 64-bit integers are `bigint` values, enums are numbers, repeated fields are arrays, and maps are objects.

Schemas can be registered in any order. If a file a message uses isn't registered yet, decoding returns the message name instead of a decoded value, and `has()` returns `false`.
`register()` and `decode()` throw for invalid schemas and messages.

A summary of the full API is available in [wpilib-protobuf.api.md](https://github.com/jonahsnider/wpilog-parser/blob/main/packages/wpilib-protobuf/etc/wpilib-protobuf.api.md).
