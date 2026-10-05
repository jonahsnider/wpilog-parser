import type { StructPayload } from './types.ts';

/** Convert a {@link StructPayload} Map to a plain JSON-compatible object. */
export function structPayloadToJson(payload: StructPayload): object {
	const result: Record<string, unknown> = {};

	for (const [key, value] of payload) {
		let converted: unknown;
		if (value instanceof Map) {
			converted = structPayloadToJson(value);
		} else if (Array.isArray(value) && value.length > 0 && value[0] instanceof Map) {
			converted = (value as StructPayload[]).map((v) => structPayloadToJson(v));
		} else {
			converted = value;
		}

		if (key === '__proto__') {
			// Assignment would invoke the inherited prototype setter.
			Object.defineProperty(result, key, { value: converted, enumerable: true, writable: true, configurable: true });
		} else {
			result[key] = converted;
		}
	}

	return result;
}
