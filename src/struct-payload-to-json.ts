import type { StructPayload } from './types.ts';

/** Convert a {@link StructPayload} Map to a plain JSON-compatible object. */
export function structPayloadToJson(payload: StructPayload): object {
	const result: Record<string, unknown> = {};

	for (const [key, value] of payload) {
		if (value instanceof Map) {
			result[key] = structPayloadToJson(value as StructPayload);
		} else if (Array.isArray(value) && value.length > 0 && value[0] instanceof Map) {
			result[key] = (value as StructPayload[]).map((v) => structPayloadToJson(v));
		} else {
			result[key] = value;
		}
	}

	return result;
}
