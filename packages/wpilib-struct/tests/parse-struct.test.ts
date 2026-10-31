import { describe, test } from 'vite-plus/test';
import { parseStructSpecification } from '../src/parse-struct.ts';
import { KnownStructTypeName } from '../src/types.ts';

describe('parse struct specification', () => {
	describe('standard declarations', () => {
		test('bool value', ({ expect }) => {
			expect(parseStructSpecification('bool value')).toStrictEqual([
				{
					name: 'value',
					value: KnownStructTypeName.Boolean,
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
			]);
		});
		test('double arr[4]', ({ expect }) => {
			expect(parseStructSpecification('double arr[4]')).toStrictEqual([
				{
					name: 'arr',
					value: KnownStructTypeName.Double,
					enumSpecification: undefined,
					arraySize: 4,
					bitWidth: undefined,
				},
			]);
		});

		test('enum {a=1, b=2} int8 val', ({ expect }) => {
			expect(parseStructSpecification('enum {a=1, b=2} int8 val')).toStrictEqual([
				{
					name: 'val',
					value: KnownStructTypeName.Int8,
					enumSpecification: new Map([
						['a', 1n],
						['b', 2n],
					]),
					arraySize: undefined,
					bitWidth: undefined,
				},
			]);
		});

		test(';;; (empty structs)', ({ expect }) => {
			expect(parseStructSpecification(';;;')).toStrictEqual([]);
		});
	});

	describe('bit-field declarations', () => {
		test('bool value : 1', ({ expect }) => {
			expect(parseStructSpecification('bool value : 1')).toStrictEqual([
				{
					name: 'value',
					value: KnownStructTypeName.Boolean,
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: 1,
				},
			]);
		});

		test('enum{a=1,b=2}int8 value:2', ({ expect }) => {
			expect(parseStructSpecification('enum{a=1,b=2}int8 value:2')).toStrictEqual([
				{
					name: 'value',
					value: KnownStructTypeName.Int8,
					enumSpecification: new Map([
						['a', 1n],
						['b', 2n],
					]),
					arraySize: undefined,
					bitWidth: 2,
				},
			]);
		});

		test('double val:2 (must be integer or boolean)', ({ expect }) => {
			expect(() => parseStructSpecification('double val:2')).toThrowError();
		});

		test('int32 val[2]:2 (cannot be array)', ({ expect }) => {
			expect(() => parseStructSpecification('int32 val[2]:2')).toThrowError();
		});

		test('bool val:3 (bool must be 1 bit)', ({ expect }) => {
			expect(() => parseStructSpecification('bool val:3')).toThrowError();
		});

		test('int16 val:17 (bit field larger than storage size)', ({ expect }) => {
			expect(() => parseStructSpecification('int16 val:17')).toThrowError();
		});
	});

	describe('real world examples', () => {
		test('ChassisSpeeds', ({ expect }) => {
			expect(parseStructSpecification('double vx;double vy;double omega')).toStrictEqual([
				{
					name: 'vx',
					value: KnownStructTypeName.Double,
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
				{
					name: 'vy',
					value: KnownStructTypeName.Double,
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
				{
					name: 'omega',
					value: KnownStructTypeName.Double,
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
			]);
		});

		test('Pose2d', ({ expect }) => {
			expect(parseStructSpecification('Translation2d translation;Rotation2d rotation')).toStrictEqual([
				{
					name: 'translation',
					value: 'Translation2d',
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
				{
					name: 'rotation',
					value: 'Rotation2d',
					enumSpecification: undefined,
					arraySize: undefined,
					bitWidth: undefined,
				},
			]);
		});

		test('SwerveDriveKinematics', ({ expect }) => {
			expect(parseStructSpecification('Translation2d modules[4]')).toStrictEqual([
				{
					name: 'modules',
					value: 'Translation2d',
					enumSpecification: undefined,
					arraySize: 4,
					bitWidth: undefined,
				},
			]);
		});
	});
});

describe('schema grammar and diagnostics', () => {
	test('empty enums, duplicate members, and exact bigint values', ({ expect }) => {
		const declarations = parseStructSpecification('{} int8 empty;{a=1,a=9007199254740993} uint64 flags');
		expect(declarations[0]!.enumSpecification).toStrictEqual(new Map());
		expect(declarations[1]!.enumSpecification).toStrictEqual(new Map([['a', 9007199254740993n]]));
	});

	test.for(['{negative=-2,positive=1,}', 'enum {negative=-2,positive=1}'])(
		'accepts signed enum values and an optional trailing comma: %s',
		(enumeration, { expect }) => {
			expect(parseStructSpecification(`${enumeration} int8 value`)[0]!.enumSpecification).toStrictEqual(
				new Map([
					['negative', -2n],
					['positive', 1n],
				]),
			);
		},
	);

	// WPILib's reference parser requires positive array sizes and bitfield widths.
	test.for(['int8 value[0]', 'int8 value[-1]', 'int8 value:0', 'int8 value:-1'])(
		'rejects non-positive sizes: %s',
		(source, { expect }) => {
			expect(() => parseStructSpecification(source)).toThrowError(expect.objectContaining({ code: 'STRUCT_R0008' }));
		},
	);

	test.for(['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'])(
		'accepts enums on %s',
		(type, { expect }) => {
			expect(parseStructSpecification(`{a=1} ${type} value`)[0]!.enumSpecification).toStrictEqual(new Map([['a', 1n]]));
		},
	);

	test.for(['bool', 'char', 'float32', 'double', 'Custom', 'int128', 'uint08', 'int8Extra', 'Int8'])(
		'rejects enums on %s',
		(type, { expect }) => {
			expect(() => parseStructSpecification(`{} ${type} value`)).toThrowError(
				expect.objectContaining({ code: 'STRUCT_R0009' }),
			);
		},
	);

	test('whitespace, empty declarations, and custom type names', ({ expect }) => {
		expect(parseStructSpecification(';;\n Custom_2\t_value [ 4 ];bool flag : 1;;')).toStrictEqual([
			{ name: '_value', value: 'Custom_2', enumSpecification: undefined, arraySize: 4, bitWidth: undefined },
			{ name: 'flag', value: 'bool', enumSpecification: undefined, arraySize: undefined, bitWidth: 1 },
		]);
	});

	test.for([
		['bool x!', 'STRUCT_R0007'],
		['int8 x:99!', 'STRUCT_R0007'],
		['int8 x:99;', 'STRUCT_R0010'],
		['int8 x:99;bool', 'STRUCT_R0008'],
		['{} bool x', 'STRUCT_R0009'],
		['Custom x:1', 'STRUCT_R0011'],
		['int8 x[2]:1', 'STRUCT_R0008'],
	])('%s reports %s', ([source, code], { expect }) => {
		expect(() => parseStructSpecification(source!)).toThrowError(expect.objectContaining({ code }));
	});

	test.for(['', ' ', '\n\t', '; ;\n;', ' \r\n ;; '])(
		'accepts empty schemas with whitespace: %j',
		(source, { expect }) => {
			expect(parseStructSpecification(source)).toStrictEqual([]);
		},
	);

	test.for(['bool value ', '\tbool\nvalue\r\n', 'bool value ; ', ' ; bool value ; ; \n'])(
		'ignores whitespace between tokens: %j',
		(source, { expect }) => {
			expect(parseStructSpecification(source)).toStrictEqual(parseStructSpecification('bool value'));
		},
	);

	test('enum is a keyword only at the start of an enum specification', ({ expect }) => {
		expect(parseStructSpecification('enumType enumValue;int8 enum')).toStrictEqual([
			{ name: 'enumValue', value: 'enumType', enumSpecification: undefined, arraySize: undefined, bitWidth: undefined },
			{ name: 'enum', value: 'int8', enumSpecification: undefined, arraySize: undefined, bitWidth: undefined },
		]);
	});

	test('decimal integers can have leading zeros', ({ expect }) => {
		const declarations = parseStructSpecification('int8 arr[01];int8 flags:01;{zero=00,one=01} int8 value');
		expect(declarations[0]!.arraySize).toBe(1);
		expect(declarations[1]!.bitWidth).toBe(1);
		expect(declarations[2]!.enumSpecification).toStrictEqual(
			new Map([
				['zero', 0n],
				['one', 1n],
			]),
		);
	});

	test.for([
		'bool 123',
		'int8 value[1x]',
		'int8 value:1x',
		'bool value bool other',
		'int8 value[1][2]',
		'enum int8 value',
	])('rejects invalid token sequences: %s', (source, { expect }) => {
		expect(() => parseStructSpecification(source)).toThrowError(expect.objectContaining({ code: 'STRUCT_R0008' }));
	});

	test('a failed parse does not affect subsequent parses', ({ expect }) => {
		expect(() => parseStructSpecification('{a=1,,} uint8 broken')).toThrowError();
		expect(parseStructSpecification('uint8 recovered')[0]!.name).toBe('recovered');
	});

	test('cached results retain their identity', ({ expect }) => {
		expect(parseStructSpecification('bool cached')).toBe(parseStructSpecification('bool cached'));
	});
});
