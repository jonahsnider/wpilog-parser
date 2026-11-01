import { describe, expect, test } from 'vite-plus/test';
import type { StructPayload } from '../src/types.ts';
import { StructRegistry } from '../src/struct-registry.ts';

describe('encode structs', () => {
	test('roundtrips primitives including 64-bit integers', () => {
		const registry = new StructRegistry();
		registry.register(
			'AllTypes',
			'bool flags[2];int8 a;uint8 b;int16 c;uint16 d;int32 e;uint32 f;int64 g;uint64 h;float i;float32 j;double k;float64 l;char text[4];char letter;enum {off=0,on=1} uint8 mode;int16 values[2]',
		);
		const value: StructPayload = {
			flags: [false, true],
			a: -3,
			b: 255,
			c: -1234,
			d: 54321,
			e: -1234567,
			f: 3456789012,
			g: -1234567890123456789n,
			h: 12345678901234567890n,
			i: 1.25,
			j: -2.5,
			k: 3.75,
			l: -4.125,
			text: 'éab',
			letter: 'Z',
			mode: 1,
			values: [-2, 3],
		};
		const encoded = registry.encode('AllTypes', value);
		expect(typeof encoded).not.toBe('string');
		expect(registry.decode('AllTypes', encoded as Uint8Array)).toStrictEqual(value);
		expect(registry.encodeInterpreted('AllTypes', value)).toStrictEqual(encoded);
	});

	test('accepts safe integers for int64 and uint64', () => {
		const registry = new StructRegistry();
		registry.register('Wide', 'int64 signed;uint64 unsigned');
		const encoded = registry.encode('Wide', { signed: -42, unsigned: 99 });
		expect(registry.decode('Wide', encoded as Uint8Array)).toStrictEqual({
			signed: -42n,
			unsigned: 99n,
		});
	});

	test('roundtrips nested Pose2d-like structs', () => {
		const registry = new StructRegistry();
		registry.register('Translation2d', 'double x;double y');
		registry.register('Rotation2d', 'double value');
		registry.register('Pose2d', 'Translation2d translation;Rotation2d rotation');

		const value: StructPayload = {
			translation: { x: 1.5, y: -2.25 },
			rotation: { value: 0.785 },
		};
		const encoded = registry.encode('Pose2d', value) as Uint8Array;
		expect(registry.decode('Pose2d', encoded)).toStrictEqual(value);
	});

	test('roundtrips nested struct arrays', () => {
		const registry = new StructRegistry();
		registry.register('Rotation2d', 'double value');
		registry.register('SwerveModuleState', 'double speed;Rotation2d angle');
		registry.register('SwerveStates', 'SwerveModuleState states[4]');

		const value: StructPayload = {
			states: [
				{ speed: 1, angle: { value: 0.1 } },
				{ speed: 2, angle: { value: 0.2 } },
				{ speed: 3, angle: { value: 0.3 } },
				{ speed: 4, angle: { value: 0.4 } },
			],
		};
		const encoded = registry.encode('SwerveStates', value) as Uint8Array;
		expect(registry.decode('SwerveStates', encoded)).toStrictEqual(value);
	});

	test('packs ControlWord-like bit fields', () => {
		const registry = new StructRegistry();
		registry.register(
			'ControlWord',
			'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
		);

		const value: StructPayload = {
			opModeHash: 0x0123_4567_89ab_cdn,
			robotMode: 2n,
			enabled: true,
			eStop: false,
			fmsAttached: true,
			dsAttached: true,
		};
		const encoded = registry.encode('ControlWord', value) as Uint8Array;
		expect(registry.decode('ControlWord', encoded)).toStrictEqual(value);
		expect(new DataView(encoded.buffer).getBigUint64(0, true)).toBe(
			0x0123_4567_89ab_cdn | (2n << 56n) | (1n << 58n) | (1n << 60n) | (1n << 61n),
		);
	});

	test("packs signed bit fields with two's complement truncation", () => {
		const registry = new StructRegistry();
		registry.register('MyStruct', 'int8 value:4');

		const encoded = registry.encode('MyStruct', { value: -3 }) as Uint8Array;
		expect(encoded).toStrictEqual(new Uint8Array([0b1101]));
		expect(registry.decode('MyStruct', encoded)).toStrictEqual({ value: -3 });
	});

	test('starts new storage when the type changes or a field does not fit', () => {
		const registry = new StructRegistry();
		registry.register('MyStruct', 'uint8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;uint8 next');

		const value: StructPayload = { low: 10, high: 11, wide: 0x101, flag: true, next: 0x7f };
		const encoded = registry.encode('MyStruct', value) as Uint8Array;
		expect(encoded).toStrictEqual(new Uint8Array([0xba, 0x01, 0x03, 0x7f]));
		expect(registry.decode('MyStruct', encoded)).toStrictEqual(value);
	});

	test('encodes char and char[N] with UTF-8 truncation and zero padding', () => {
		const registry = new StructRegistry();
		registry.register('Text', 'char letter;char text[4];char trailer');

		const encoded = registry.encode('Text', {
			letter: 'A',
			text: 'éabc',
			trailer: 'Z',
		}) as Uint8Array;
		// é is 2 UTF-8 bytes, so text[4] keeps éab and truncates c; remainder is unused.
		expect(encoded).toStrictEqual(new Uint8Array([0x41, 0xc3, 0xa9, 0x61, 0x62, 0x5a]));
		expect(registry.decode('Text', encoded)).toStrictEqual({
			letter: 'A',
			text: 'éab',
			trailer: 'Z',
		});

		const padded = registry.encode('Text', { letter: 'A', text: 'hi', trailer: 'Z' }) as Uint8Array;
		expect(padded).toStrictEqual(new Uint8Array([0x41, 0x68, 0x69, 0, 0, 0x5a]));
		expect(registry.decode('Text', padded)).toStrictEqual({
			letter: 'A',
			text: 'hi\0\0',
			trailer: 'Z',
		});
	});

	test('encodeArray roundtrips with decodeArray', () => {
		const registry = new StructRegistry();
		registry.register('Point', 'int16 x;int16 y');
		const values: StructPayload[] = [
			{ x: 1, y: -2 },
			{ x: 3, y: 4 },
			{ x: -5, y: 6 },
		];
		const encoded = registry.encodeArray('Point', values) as Uint8Array;
		expect(encoded.byteLength).toBe(12);
		expect(registry.decodeArray('Point', encoded)).toStrictEqual(values);
	});

	test('encodeInto writes at a nonzero byteOffset subarray', () => {
		const registry = new StructRegistry();
		registry.register('Inner', 'int8 value:4');
		registry.register('Outer', 'Inner inner;uint16 tail');

		const backing = new Uint8Array([99, 99, 99, 99, 99, 99]);
		const bytes = backing.subarray(1, 5);
		bytes.fill(0xff);
		const written = registry.encodeInto('Outer', { inner: { value: -3 }, tail: 513 }, bytes, 1);
		expect(written).toBe(3);
		expect(backing).toStrictEqual(new Uint8Array([99, 0xff, 0x0d, 0x01, 0x02, 99]));
		expect(registry.decode('Outer', bytes, 1)).toStrictEqual({ inner: { value: -3 }, tail: 513 });
		expect(() => registry.encodeInto('Outer', { inner: { value: -3 }, tail: 513 }, bytes.subarray(0, 3), 1)).toThrow(
			RangeError,
		);
	});

	test('returns missing schema names without throwing STRUCT_R0013', () => {
		const registry = new StructRegistry();
		registry.register('Outer', 'uint8 prefix;Inner value');
		expect(registry.encode('Outer', { prefix: 42, value: { value: 7 } })).toBe('Inner');
		expect(registry.encodeInto('Outer', { prefix: 42, value: { value: 7 } }, new Uint8Array(2))).toBe('Inner');
		expect(registry.encodeArray('Outer', [{ prefix: 42, value: { value: 7 } }])).toBe('Inner');
		expect(registry.encode('Missing', {})).toBe('Missing');
		expect(registry.encodeArray('Missing', [])).toBe('Missing');
	});

	test('preserves __proto__ field names via defineProperty', () => {
		const registry = new StructRegistry();
		registry.register('Inner', 'uint8 __proto__');
		registry.register(
			'Names',
			'uint8 prefix;Inner __proto__;uint8 constructor;uint8 hasOwnProperty;uint8 get;uint8 set;uint8 size;uint8 tail',
		);

		const value: StructPayload = {
			prefix: 42,
			constructor: 2,
			hasOwnProperty: 3,
			get: 4,
			set: 5,
			size: 6,
			tail: 7,
		};
		Object.defineProperty(value, '__proto__', {
			value: Object.defineProperty({} as StructPayload, '__proto__', {
				value: 1,
				enumerable: true,
				writable: true,
				configurable: true,
			}),
			enumerable: true,
			writable: true,
			configurable: true,
		});

		const encoded = registry.encode('Names', value) as Uint8Array;
		const decoded = registry.decode('Names', encoded);
		expect(decoded).toStrictEqual({
			prefix: 42,
			['__proto__']: { ['__proto__']: 1 },
			constructor: 2,
			hasOwnProperty: 3,
			get: 4,
			set: 5,
			size: 6,
			tail: 7,
		});
		expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')).toEqual({
			value: { ['__proto__']: 1 },
			enumerable: true,
			writable: true,
			configurable: true,
		});
	});

	test('rejects missing fields, wrong array lengths, and wrong types', () => {
		const registry = new StructRegistry();
		registry.register('Point', 'int16 x;int16 y[2];bool flag;char label[2]');
		expect(() => registry.encode('Point', { x: 1, y: [2, 3], label: 'ab' })).toThrow(TypeError);
		expect(() => registry.encode('Point', { x: 1, y: [2], flag: true, label: 'ab' })).toThrow(RangeError);
		expect(() => registry.encode('Point', { x: 1, y: [2, 3], flag: 1, label: 'ab' })).toThrow(TypeError);
		expect(() => registry.encode('Point', { x: 1, y: [2, 3], flag: true, label: [1, 2] })).toThrow(TypeError);
		expect(() => registry.encode('Point', { x: 1n as unknown as number, y: [2, 3], flag: true, label: 'ab' })).toThrow(
			TypeError,
		);
	});

	test('rejects nonempty arrays of zero-length structs', () => {
		const registry = new StructRegistry();
		registry.register('Empty', '');
		expect(registry.encode('Empty', {})).toStrictEqual(new Uint8Array());
		expect(registry.encodeArray('Empty', [])).toStrictEqual(new Uint8Array());
		expect(() => registry.encodeArray('Empty', [{}])).toThrow(RangeError);
	});
});
