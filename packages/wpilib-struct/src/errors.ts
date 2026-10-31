/** Stable, protocol-neutral schema error codes. */
export type StructErrorCode =
	| 'STRUCT_R0007'
	| 'STRUCT_R0008'
	| 'STRUCT_R0009'
	| 'STRUCT_R0010'
	| 'STRUCT_R0011'
	| 'STRUCT_R0012'
	| 'STRUCT_R0013';

/** Context associated with a schema error. */
export type StructErrorDetails = {
	name?: string;
	type?: string;
	width?: number;
	maxBits?: number;
};

/** A schema error, independent of WPILOG records or NetworkTables topics. */
export class StructError extends Error {
	readonly code: StructErrorCode;
	readonly details: StructErrorDetails;

	constructor(code: StructErrorCode, message: string, details: StructErrorDetails = {}, options?: ErrorOptions) {
		super(message, options);
		this.name = 'StructError';
		this.code = code;
		this.details = details;
	}
}

export const diagnostics = {
	STRUCT_R0007: (options?: ErrorOptions) =>
		new StructError('STRUCT_R0007', 'Failed to lex struct specification', {}, options),
	STRUCT_R0008: (options?: ErrorOptions) =>
		new StructError('STRUCT_R0008', 'Failed to parse struct specification', {}, options),
	STRUCT_R0009: () => new StructError('STRUCT_R0009', 'Enums must be integers'),
	STRUCT_R0010: (details: { type: string; width: number; maxBits: number }) =>
		new StructError(
			'STRUCT_R0010',
			`Invalid ${details.width}-bit field for ${details.type} (maximum ${details.maxBits} bits)`,
			details,
		),
	STRUCT_R0011: () => new StructError('STRUCT_R0011', 'Bit-field members must be integers or booleans'),
	STRUCT_R0012: (details: { name: string }) =>
		new StructError('STRUCT_R0012', `Cycle detected in the dependency graph for ${details.name}`, details),
	STRUCT_R0013: (details: { name: string }) =>
		new StructError('STRUCT_R0013', `Unknown struct definition: ${details.name}`, details),
};
