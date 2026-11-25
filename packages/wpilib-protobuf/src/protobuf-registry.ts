import { createFileRegistry, type DescFile, type DescMessage, fromBinary } from '@bufbuild/protobuf';
import { nestedTypes, type ReflectMessage, reflect } from '@bufbuild/protobuf/reflect';
import { FeatureSet_FieldPresence, type FileDescriptorProto, FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt';

/** A decoded protobuf field value. 64-bit integers are `bigint`s, enums are numbers, and maps are objects. */
export type ProtobufValue = number | bigint | boolean | string | Uint8Array | ProtobufPayload | ProtobufValue[];

/** A decoded protobuf message. Fields, including nested messages, are own properties of a plain object named as declared in the schema. */
export type ProtobufPayload = { [field: string]: ProtobufValue | undefined };

/**
 * Decodes protobuf messages from the file descriptors that describe them, like the `/.schema/proto:*` entries WPILib
 * logs and publishes to NetworkTables.
 */
export class ProtobufRegistry {
	// Files whose imports are all registered
	private readonly files = new Map<string, DescFile>();
	// Files waiting for an import to be registered
	private readonly waiting = new Map<string, FileDescriptorProto>();
	private readonly messages = new Map<string, DescMessage>();

	/**
	 * Register a serialized `google.protobuf.FileDescriptorProto`. Files can be registered in any order, a file's
	 * messages can be decoded once every file it imports is registered. Registering a file again is ignored.
	 * Throws if the descriptor is invalid.
	 */
	register(descriptor: Uint8Array): void {
		const file = fromBinary(FileDescriptorProtoSchema, descriptor);
		if (this.files.has(file.name) || this.waiting.has(file.name)) {
			return;
		}
		this.waiting.set(file.name, file);

		// Registering a file can complete the imports of other waiting files, and of files waiting on those
		let added = true;
		while (added) {
			added = false;
			for (const [name, proto] of this.waiting) {
				if (!proto.dependency.every((dependency) => this.files.has(dependency))) {
					continue;
				}
				this.waiting.delete(name);
				const file = createFileRegistry(proto, (dependency) => this.files.get(dependency)).getFile(name)!;
				// Keyed by the name imports use, `DescFile.name` leaves out the `.proto` extension
				this.files.set(name, file);
				for (const type of nestedTypes(file)) {
					if (type.kind === 'message') {
						this.messages.set(type.typeName, type);
					}
				}
				added = true;
			}
		}
	}

	/** Whether messages of a type can be decoded, ex. `wpi.proto.ProtobufPose2d` */
	has(messageName: string): boolean {
		return this.messages.has(messageName);
	}

	/**
	 * Decode a message of a type, ex. `wpi.proto.ProtobufPose2d`. Returns the type's name instead when its file, or a
	 * file it imports, isn't registered yet. Throws if the bytes aren't a valid message of that type.
	 *
	 * Fields without presence tracking, like most proto3 scalars, always have a value, their default when not set.
	 * Unset message fields, `optional` fields, and oneof members are left out.
	 */
	decode(messageName: string, bytes: Uint8Array): ProtobufPayload | string {
		const desc = this.messages.get(messageName);
		if (desc === undefined) {
			return messageName;
		}
		return toPayload(reflect(desc, fromBinary(desc, bytes)));
	}
}

function toPayload(message: ReflectMessage): ProtobufPayload {
	const payload: ProtobufPayload = {};
	for (const field of message.fields) {
		let value: ProtobufValue;
		switch (field.fieldKind) {
			case 'scalar':
			case 'enum':
				if (field.presence !== FeatureSet_FieldPresence.IMPLICIT && !message.isSet(field)) {
					continue;
				}
				value = message.get(field) as ProtobufValue;
				break;
			case 'message':
				if (!message.isSet(field)) {
					continue;
				}
				value = toPayload(message.get(field));
				break;
			case 'list': {
				const list = message.get(field);
				value = [];
				for (const item of list) {
					value.push(field.listKind === 'message' ? toPayload(item as ReflectMessage) : (item as ProtobufValue));
				}
				break;
			}
			case 'map': {
				const map: ProtobufPayload = {};
				for (const [key, item] of message.get(field)) {
					setField(
						map,
						String(key),
						field.mapKind === 'message' ? toPayload(item as ReflectMessage) : (item as ProtobufValue),
					);
				}
				value = map;
				break;
			}
		}
		setField(payload, field.name, value);
	}
	return payload;
}

/** Set an own property, including for keys like `__proto__` that assignment would treat as the prototype */
function setField(payload: ProtobufPayload, key: string, value: ProtobufValue): void {
	if (key === '__proto__') {
		Object.defineProperty(payload, key, { value, enumerable: true, writable: true, configurable: true });
	} else {
		payload[key] = value;
	}
}
