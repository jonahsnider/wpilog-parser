// Descriptors and messages encoded by protoc from WPILib's wpimath/src/main/proto files (v2026.2.1), which WPILib logs
// as `/.schema/proto:<file>` entries. A copy of some of wpilib-protobuf's test fixtures.

export const descriptors = {
	geometry2d: base64(
		'ChBnZW9tZXRyeTJkLnByb3RvEgl3cGkucHJvdG8iMwoVUHJvdG9idWZUcmFuc2xhdGlvbjJkEgwKAXgYASABKAFSAXgSDAoBeRgCIAEoAVIBeSIqChJQcm90b2J1ZlJvdGF0aW9uMmQSFAoFdmFsdWUYASABKAFSBXZhbHVlIo8BCg5Qcm90b2J1ZlBvc2UyZBJCCgt0cmFuc2xhdGlvbhgBIAEoCzIgLndwaS5wcm90by5Qcm90b2J1ZlRyYW5zbGF0aW9uMmRSC3RyYW5zbGF0aW9uEjkKCHJvdGF0aW9uGAIgASgLMh0ud3BpLnByb3RvLlByb3RvYnVmUm90YXRpb24yZFIIcm90YXRpb24ilAEKE1Byb3RvYnVmVHJhbnNmb3JtMmQSQgoLdHJhbnNsYXRpb24YASABKAsyIC53cGkucHJvdG8uUHJvdG9idWZUcmFuc2xhdGlvbjJkUgt0cmFuc2xhdGlvbhI5Cghyb3RhdGlvbhgCIAEoCzIdLndwaS5wcm90by5Qcm90b2J1ZlJvdGF0aW9uMmRSCHJvdGF0aW9uIkkKD1Byb3RvYnVmVHdpc3QyZBIOCgJkeBgBIAEoAVICZHgSDgoCZHkYAiABKAFSAmR5EhYKBmR0aGV0YRgDIAEoAVIGZHRoZXRhIngKE1Byb3RvYnVmUmVjdGFuZ2xlMmQSMQoGY2VudGVyGAEgASgLMhkud3BpLnByb3RvLlByb3RvYnVmUG9zZTJkUgZjZW50ZXISFgoGeFdpZHRoGAIgASgBUgZ4V2lkdGgSFgoGeVdpZHRoGAMgASgBUgZ5V2lkdGgiggEKEVByb3RvYnVmRWxsaXBzZTJkEjEKBmNlbnRlchgBIAEoCzIZLndwaS5wcm90by5Qcm90b2J1ZlBvc2UyZFIGY2VudGVyEhwKCXhTZW1pQXhpcxgCIAEoAVIJeFNlbWlBeGlzEhwKCXlTZW1pQXhpcxgDIAEoAVIJeVNlbWlBeGlzQhoKGGVkdS53cGkuZmlyc3QubWF0aC5wcm90b2IGcHJvdG8z',
	),
	/** Imports geometry2d.proto */
	trajectory: base64(
		'ChB0cmFqZWN0b3J5LnByb3RvEgl3cGkucHJvdG8aEGdlb21ldHJ5MmQucHJvdG8iugEKF1Byb3RvYnVmVHJhamVjdG9yeVN0YXRlEhIKBHRpbWUYASABKAFSBHRpbWUSGgoIdmVsb2NpdHkYAiABKAFSCHZlbG9jaXR5EiIKDGFjY2VsZXJhdGlvbhgDIAEoAVIMYWNjZWxlcmF0aW9uEi0KBHBvc2UYBCABKAsyGS53cGkucHJvdG8uUHJvdG9idWZQb3NlMmRSBHBvc2USHAoJY3VydmF0dXJlGAUgASgBUgljdXJ2YXR1cmUiUAoSUHJvdG9idWZUcmFqZWN0b3J5EjoKBnN0YXRlcxgCIAMoCzIiLndwaS5wcm90by5Qcm90b2J1ZlRyYWplY3RvcnlTdGF0ZVIGc3RhdGVzQhoKGGVkdS53cGkuZmlyc3QubWF0aC5wcm90b2IGcHJvdG8z',
	),
};

export const messages = {
	/** `translation { x: 1.5 y: -2 } rotation { value: 3 }` */
	pose: hex('0a1209000000000000f83f1100000000000000c01209090000000000000840'),
	/** `states { time: 0.5 velocity: 1.25 pose { translation { x: 1 y: 2 } rotation { value: 0.5 } } } states { time: 1 }` */
	trajectory: hex(
		'123309000000000000e03f11000000000000f43f221f0a1209000000000000f03f110000000000000040120909000000000000e03f120909000000000000f03f',
	),
};

function base64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hex(value: string): Uint8Array {
	return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

/** Encode a `wpi.proto.ProtobufPose2d`, like WPILib does with every field written */
export function encodePose2d(x: number, y: number, rotation: number): Uint8Array {
	const bytes = new Uint8Array(31);
	const view = new DataView(bytes.buffer);
	// translation (field 1, 18 bytes): x (field 1) and y (field 2) doubles
	bytes.set([0x0a, 18, 0x09], 0);
	view.setFloat64(3, x, true);
	bytes[11] = 0x11;
	view.setFloat64(12, y, true);
	// rotation (field 2, 9 bytes): value (field 1) double
	bytes.set([0x12, 9, 0x09], 20);
	view.setFloat64(23, rotation, true);
	return bytes;
}
