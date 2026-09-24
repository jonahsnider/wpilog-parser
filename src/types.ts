/** The parsed WPILOG file header. */
export type DataLogHeader = {
	version: {
		major: number;
		minor: number;
	};
	extraHeader: string;
};

/** Control record types in the WPILOG format. */
export const ControlRecordType = {
	Start: 0,
	Finish: 1,
	SetMetadata: 2,
} as const;

export type ControlRecordType = (typeof ControlRecordType)[keyof typeof ControlRecordType];

/** A control record that starts a new entry. */
export type StartControlRecord = {
	controlRecordType: typeof ControlRecordType.Start;
	entryId: number;
	entryName: string;
	entryType: string;
	entryMetadata: string;
};

/** A control record that finishes an entry. */
export type FinishControlRecord = {
	controlRecordType: typeof ControlRecordType.Finish;
	entryId: number;
};

/** A control record that sets metadata on an entry. */
export type SetMetadataControlRecord = {
	controlRecordType: typeof ControlRecordType.SetMetadata;
	entryId: number;
	entryMetadata: string;
};

/** A control record payload (start, finish, or set metadata). */
export type ControlRecordPayload = StartControlRecord | FinishControlRecord | SetMetadataControlRecord;

/** A raw (undecoded) data log record from the binary format. */
export type RawRecord = {
	entryId: number;
	/** Timestamp in microseconds. */
	timestamp: bigint;
	payload: Uint8Array;
};

/** Discriminated union tag for decoded record types. */
export const RecordType = {
	Control: 'control',
	Boolean: 'boolean',
	Int64: 'int64',
	Float: 'float',
	Double: 'double',
	String: 'string',
	BooleanArray: 'boolean[]',
	Int64Array: 'int64[]',
	FloatArray: 'float[]',
	DoubleArray: 'double[]',
	StringArray: 'string[]',
	Struct: 'struct',
	StructArray: 'struct[]',
	Raw: 'raw',
} as const;

export type RecordType = (typeof RecordType)[keyof typeof RecordType];

/** Decoded struct payload — a map of field names to values. */
export type StructPayload = Map<
	string,
	number | boolean | bigint | string | StructPayload | number[] | boolean[] | bigint[] | StructPayload[]
>;

/** A decoded data record (excludes control records). */
export type DataRecord = Extract<DecodedRecord, { name: string }>;

/** A decoded control record. */
export type ControlRecord = Extract<DecodedRecord, { type: typeof RecordType.Control }>;

/** Type guard that narrows a {@link DecodedRecord} to a {@link DataRecord}. */
export function isDataRecord(record: DecodedRecord): record is DataRecord {
	return record.type !== RecordType.Control;
}

/** A decoded data log record. */
export type DecodedRecord = {
	entryId: number;
	/** Timestamp in microseconds. */
	timestamp: bigint;
} & (
	| { type: typeof RecordType.Control; payload: ControlRecordPayload }
	| ({
			name: string;
			metadata: string;
	  } & (
			| { type: typeof RecordType.Raw; payload: Uint8Array }
			| { type: typeof RecordType.Boolean; payload: boolean }
			| { type: typeof RecordType.Int64; payload: bigint }
			| { type: typeof RecordType.Float; payload: number }
			| { type: typeof RecordType.Double; payload: number }
			| { type: typeof RecordType.String; payload: string }
			| { type: typeof RecordType.BooleanArray; payload: boolean[] }
			| { type: typeof RecordType.Int64Array; payload: bigint[] }
			| { type: typeof RecordType.FloatArray; payload: number[] }
			| { type: typeof RecordType.DoubleArray; payload: number[] }
			| { type: typeof RecordType.StringArray; payload: string[] }
			| { type: typeof RecordType.Struct; structName: string; payload: StructPayload }
			| { type: typeof RecordType.StructArray; structName: string; payload: StructPayload[] }
	  ))
);
