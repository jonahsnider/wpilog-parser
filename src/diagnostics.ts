import { defineDiagnostics } from 'nostics';

/** Stable codes for errors callers can act on. */
export const diagnostics = defineDiagnostics({
	codes: {
		WPILOG_C0001: {
			why: (p: { command: string }) => `Unknown command \`${p.command}\``,
			fix: 'Run `wpilog --help` to see the available commands.',
		},
		WPILOG_C0002: {
			why: 'Output flags cannot be combined',
			fix: 'Choose one of --json, --jsonl, --ndjson, or --csv.',
		},
		WPILOG_C0003: {
			why: (p: { filePath: string }) => `File not found: ${p.filePath}`,
			fix: 'Check the path and try again with an existing WPILOG file.',
		},
		WPILOG_R0001: {
			why: (p: { type: number }) => `Invalid control record type ${p.type}`,
			fix: 'Check that the input is an uncorrupted WPILOG file.',
		},
		WPILOG_R0002: {
			why: 'Not a WPILOG file (truncated header)',
			fix: 'Provide a complete WPILOG file.',
		},
		WPILOG_R0003: {
			why: 'Not a WPILOG file (invalid magic bytes)',
			fix: 'Provide a file in WPILOG format.',
		},
		WPILOG_R0004: {
			why: 'Not a WPILOG file (truncated extra header)',
			fix: 'Provide a complete WPILOG file.',
		},
		WPILOG_R0005: {
			why: (p: { byte: number }) => `Invalid boolean value ${p.byte}`,
			fix: 'Use 0 or 1 for boolean values in the log.',
		},
		WPILOG_R0006: {
			why: (p: { entryId: number }) => `No type registered for entry ID ${p.entryId}`,
			fix: 'Include a Start control record for this entry before its data records.',
		},
		WPILOG_R0007: {
			why: 'Failed to lex struct specification',
			fix: 'Check the struct specification for invalid characters or tokens.',
		},
		WPILOG_R0008: {
			why: 'Failed to parse struct specification',
			fix: 'Check the struct specification syntax.',
		},
		WPILOG_R0009: {
			why: 'Enums must be integers',
			fix: 'Use an integer type for enum members.',
		},
		WPILOG_R0010: {
			why: (p: { type: string; width: number; maxBits: number }) =>
				`Invalid ${p.width}-bit field for ${p.type} (maximum ${p.maxBits} bits)`,
			fix: (p: { maxBits: number }) => `Use a bit width from 1 to ${p.maxBits}.`,
		},
		WPILOG_R0011: {
			why: 'Bit-field members must be integers or booleans',
			fix: 'Use an integer or boolean type for bit-field members.',
		},
		WPILOG_R0012: {
			why: (p: { name: string }) => `Cycle detected in the dependency graph for ${p.name}`,
			fix: 'Remove the circular struct reference.',
		},
		WPILOG_R0013: {
			why: (p: { name: string }) => `Unknown struct definition: ${p.name}`,
			fix: 'Register the struct definition before decoding its records.',
		},
		WPILOG_R0014: {
			why: 'Bit-field members are not implemented',
			fix: 'Avoid bit-field members in struct definitions until decoding support is available.',
		},
	},
});
