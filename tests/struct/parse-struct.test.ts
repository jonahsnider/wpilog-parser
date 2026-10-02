import { describe, expect, test } from 'vite-plus/test';
import { parseStructSpecification } from '../../src/struct/parse-struct.ts';
import { KnownStructTypeName } from '../../src/struct/types.ts';

describe('parse struct specification', () => {
	describe('standard declarations', () => {
		test('bool value', () => {
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
		test('double arr[4]', () => {
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

		test('enum {a=1, b=2} int8 val', () => {
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

		test(';;; (empty structs)', () => {
			expect(parseStructSpecification(';;;')).toStrictEqual([]);
		});
	});

	describe('bit-field declarations', () => {
		test('bool value : 1', () => {
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

		test('enum{a=1,b=2}int8 value:2', () => {
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

		test('double val:2 (must be integer or boolean)', () => {
			expect(() => parseStructSpecification('double val:2')).toThrowError();
		});

		test('int32 val[2]:2 (cannot be array)', () => {
			expect(() => parseStructSpecification('int32 val[2]:2')).toThrowError();
		});

		test('bool val:3 (bool must be 1 bit)', () => {
			expect(() => parseStructSpecification('bool val:3')).toThrowError();
		});

		test('int16 val:17 (bit field larger than storage size)', () => {
			expect(() => parseStructSpecification('int16 val:17')).toThrowError();
		});
	});

	describe('real world examples', () => {
		test('ChassisSpeeds', () => {
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

		test('Pose2d', () => {
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

		test('SwerveDriveKinematics', () => {
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
