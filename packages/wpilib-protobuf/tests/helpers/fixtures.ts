// Descriptors and messages encoded by protoc from WPILib's wpimath/src/main/proto files (v2026.2.1), which WPILib logs
// as `/.schema/proto:<file>` entries, and a test.proto covering features WPILib's files don't use

export const descriptors = {
	geometry2d: base64(
		'ChBnZW9tZXRyeTJkLnByb3RvEgl3cGkucHJvdG8iMwoVUHJvdG9idWZUcmFuc2xhdGlvbjJkEgwKAXgYASABKAFSAXgSDAoBeRgCIAEoAVIBeSIqChJQcm90b2J1ZlJvdGF0aW9uMmQSFAoFdmFsdWUYASABKAFSBXZhbHVlIo8BCg5Qcm90b2J1ZlBvc2UyZBJCCgt0cmFuc2xhdGlvbhgBIAEoCzIgLndwaS5wcm90by5Qcm90b2J1ZlRyYW5zbGF0aW9uMmRSC3RyYW5zbGF0aW9uEjkKCHJvdGF0aW9uGAIgASgLMh0ud3BpLnByb3RvLlByb3RvYnVmUm90YXRpb24yZFIIcm90YXRpb24ilAEKE1Byb3RvYnVmVHJhbnNmb3JtMmQSQgoLdHJhbnNsYXRpb24YASABKAsyIC53cGkucHJvdG8uUHJvdG9idWZUcmFuc2xhdGlvbjJkUgt0cmFuc2xhdGlvbhI5Cghyb3RhdGlvbhgCIAEoCzIdLndwaS5wcm90by5Qcm90b2J1ZlJvdGF0aW9uMmRSCHJvdGF0aW9uIkkKD1Byb3RvYnVmVHdpc3QyZBIOCgJkeBgBIAEoAVICZHgSDgoCZHkYAiABKAFSAmR5EhYKBmR0aGV0YRgDIAEoAVIGZHRoZXRhIngKE1Byb3RvYnVmUmVjdGFuZ2xlMmQSMQoGY2VudGVyGAEgASgLMhkud3BpLnByb3RvLlByb3RvYnVmUG9zZTJkUgZjZW50ZXISFgoGeFdpZHRoGAIgASgBUgZ4V2lkdGgSFgoGeVdpZHRoGAMgASgBUgZ5V2lkdGgiggEKEVByb3RvYnVmRWxsaXBzZTJkEjEKBmNlbnRlchgBIAEoCzIZLndwaS5wcm90by5Qcm90b2J1ZlBvc2UyZFIGY2VudGVyEhwKCXhTZW1pQXhpcxgCIAEoAVIJeFNlbWlBeGlzEhwKCXlTZW1pQXhpcxgDIAEoAVIJeVNlbWlBeGlzQhoKGGVkdS53cGkuZmlyc3QubWF0aC5wcm90b2IGcHJvdG8z',
	),
	trajectory: base64(
		'ChB0cmFqZWN0b3J5LnByb3RvEgl3cGkucHJvdG8aEGdlb21ldHJ5MmQucHJvdG8iugEKF1Byb3RvYnVmVHJhamVjdG9yeVN0YXRlEhIKBHRpbWUYASABKAFSBHRpbWUSGgoIdmVsb2NpdHkYAiABKAFSCHZlbG9jaXR5EiIKDGFjY2VsZXJhdGlvbhgDIAEoAVIMYWNjZWxlcmF0aW9uEi0KBHBvc2UYBCABKAsyGS53cGkucHJvdG8uUHJvdG9idWZQb3NlMmRSBHBvc2USHAoJY3VydmF0dXJlGAUgASgBUgljdXJ2YXR1cmUiUAoSUHJvdG9idWZUcmFqZWN0b3J5EjoKBnN0YXRlcxgCIAMoCzIiLndwaS5wcm90by5Qcm90b2J1ZlRyYWplY3RvcnlTdGF0ZVIGc3RhdGVzQhoKGGVkdS53cGkuZmlyc3QubWF0aC5wcm90b2IGcHJvdG8z',
	),
	/**
	 * ```proto
	 * message Everything {
	 *   int64 count = 1;
	 *   optional double maybe = 2;
	 *   Mode mode = 3; // MODE_UNKNOWN = 0, MODE_AUTO = 1
	 *   repeated wpi.proto.ProtobufPose2d poses = 4;
	 *   map<string, int32> counts = 5;
	 *   oneof choice { string text = 6; wpi.proto.ProtobufRotation2d angle = 7; }
	 *   wpi.proto.ProtobufPose2d unset_pose = 8;
	 *   bytes data = 9;
	 *   repeated double values = 10;
	 * }
	 * ```
	 */
	test: base64(
		'Cgp0ZXN0LnByb3RvEgR0ZXN0GhBnZW9tZXRyeTJkLnByb3RvIsYDCgpFdmVyeXRoaW5nEhQKBWNvdW50GAEgASgDUgVjb3VudBIZCgVtYXliZRgCIAEoAUgBUgVtYXliZYgBARIeCgRtb2RlGAMgASgOMgoudGVzdC5Nb2RlUgRtb2RlEi8KBXBvc2VzGAQgAygLMhkud3BpLnByb3RvLlByb3RvYnVmUG9zZTJkUgVwb3NlcxI0CgZjb3VudHMYBSADKAsyHC50ZXN0LkV2ZXJ5dGhpbmcuQ291bnRzRW50cnlSBmNvdW50cxIUCgR0ZXh0GAYgASgJSABSBHRleHQSNQoFYW5nbGUYByABKAsyHS53cGkucHJvdG8uUHJvdG9idWZSb3RhdGlvbjJkSABSBWFuZ2xlEjgKCnVuc2V0X3Bvc2UYCCABKAsyGS53cGkucHJvdG8uUHJvdG9idWZQb3NlMmRSCXVuc2V0UG9zZRISCgRkYXRhGAkgASgMUgRkYXRhEhYKBnZhbHVlcxgKIAMoAVIGdmFsdWVzGjkKC0NvdW50c0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgFUgV2YWx1ZToCOAFCCAoGY2hvaWNlQggKBl9tYXliZSonCgRNb2RlEhAKDE1PREVfVU5LTk9XThAAEg0KCU1PREVfQVVUTxABYgZwcm90bzM=',
	),
};

export const messages = {
	/** `translation { x: 1.5 y: -2 } rotation { value: 3 }` */
	pose: hex('0a1209000000000000f83f1100000000000000c01209090000000000000840'),
	/** `states { time: 0.5 velocity: 1.25 pose { translation { x: 1 y: 2 } rotation { value: 0.5 } } } states { time: 1 }` */
	trajectory: hex(
		'123309000000000000e03f11000000000000f43f221f0a1209000000000000f03f110000000000000040120909000000000000e03f120909000000000000f03f',
	),
	/**
	 * `count: -9007199254740993 mode: MODE_AUTO poses { translation { x: 1 } } poses {} counts { key: "a" value: 1 }
	 * counts { key: "b" value: 2 } angle { value: 0.25 } data: "\x01\x02" values: [1.5, 2.5]`
	 */
	everything: hex(
		'08ffffffffffffffefff011801220b0a0909000000000000f03f22002a050a016110012a050a016210023a0909000000000000d03f4a0201025210000000000000f83f0000000000000440',
	),
	/** `text: "hi" maybe: 0` */
	text: hex('11000000000000000032026869'),
};

function base64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hex(value: string): Uint8Array {
	return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

/** Encode a `wpi.proto.ProtobufPose2d`, like WPILib does with every field written */
export function encodePose2d(x: number, y: number, rotation: number): Uint8Array {
	return concat(field(1, concat(double(1, x), double(2, y))), field(2, double(1, rotation)));
}

/** Encode a `wpi.proto.ProtobufTrajectory` with `length` states */
export function encodeTrajectory(length: number): Uint8Array {
	const states = Array.from({ length }, (_, index) =>
		field(
			2,
			concat(
				double(1, index * 0.02),
				double(2, index * 0.1),
				double(3, 0.5),
				field(4, encodePose2d(index * 0.01, index * -0.01, index * 0.001)),
				double(5, index * 0.003),
			),
		),
	);
	return concat(...states);
}

function double(fieldNumber: number, value: number): Uint8Array {
	const bytes = new Uint8Array(9);
	bytes[0] = (fieldNumber << 3) | 1;
	new DataView(bytes.buffer).setFloat64(1, value, true);
	return bytes;
}

/** A length-delimited field, only for contents shorter than 128 bytes */
function field(fieldNumber: number, contents: Uint8Array): Uint8Array {
	if (contents.byteLength >= 128) throw new RangeError('Contents too long for a one-byte length');
	return concat(new Uint8Array([(fieldNumber << 3) | 2, contents.byteLength]), contents);
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}
