export const KnownStructTypeName = {
	Boolean: 'bool',
	Character: 'char',
	Int8: 'int8',
	Int16: 'int16',
	Int32: 'int32',
	Int64: 'int64',
	Uint8: 'uint8',
	Uint16: 'uint16',
	Uint32: 'uint32',
	Uint64: 'uint64',
	Float32: 'float32',
	/** Equivalent to {@link KnownStructTypeName.Float32} */
	Float: 'float',
	Float64: 'float64',
	/** Equivalent to {@link KnownStructTypeName.Float64} */
	Double: 'double',
} as const;

export type KnownStructTypeName = (typeof KnownStructTypeName)[keyof typeof KnownStructTypeName];

export type StructTypeName = string;

export type EnumSpecification = Map<string, bigint>;

export type StructSpecification = StructDeclaration[];

export type StructDeclaration = {
	name: string;
	value: StructTypeName;
	enumSpecification?: EnumSpecification;
	arraySize?: number;
	bitWidth?: number;
};
