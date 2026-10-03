import { StructDecodeQueue } from '../../src/struct/struct-decode-queue.ts';
import { StructRegistry } from '../../src/struct/struct-registry.ts';

// Representative WPILib shapes, with varying payloads to avoid benchmarking a
// single constant input. Schema registration happens outside timed decoding.
export const STRUCT_FIXTURES = [
	{ name: 'Translation2d', schemas: { Translation2d: 'double x;double y' } },
	{
		name: 'Pose2d',
		schemas: {
			Translation2d: 'double x;double y',
			Rotation2d: 'double value',
			Pose2d: 'Translation2d translation;Rotation2d rotation',
		},
	},
	{
		name: 'SwerveStates',
		schemas: {
			Rotation2d: 'double value',
			SwerveModuleState: 'double speed;Rotation2d angle',
			SwerveStates: 'SwerveModuleState states[4]',
		},
	},
	{
		name: 'ControlWord',
		schemas: {
			ControlWord:
				'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
		},
	},
] as const;

export function createStructFixture(fixture: (typeof STRUCT_FIXTURES)[number]) {
	const registry = new StructRegistry(new StructDecodeQueue(() => {}));
	for (const [name, schema] of Object.entries(fixture.schemas)) registry.register(name, schema);
	const size = registry.getByteLength(fixture.name);
	if (typeof size !== 'number') throw new TypeError(`Missing schema: ${size}`);
	const payloads = Array.from({ length: 32 }, (_, index) => {
		// Include a nonzero byteOffset, as real records are subarrays of a log.
		const bytes = new Uint8Array(size + 3).subarray(3);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let offset = 0; offset < size; offset += 8) {
			if (fixture.name === 'ControlWord') view.setBigUint64(offset, BigInt(index) | (BigInt(index) << 56n), true);
			else view.setFloat64(offset, index + offset / 8 + 0.25, true);
		}
		return bytes;
	});
	return { registry, payloads };
}
