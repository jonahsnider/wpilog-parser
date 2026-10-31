import { describe, test, vi } from 'vite-plus/test';
import { StructDecodeQueue } from '../../src/struct/struct-decode-queue.ts';
import type { RawRecord } from '../../src/types.ts';

describe('struct decode queue', () => {
	test('waits for struct definition before processing queued records', ({ expect }) => {
		const callback = vi.fn();
		const queue = new StructDecodeQueue(callback);

		const pose2dRecord: RawRecord = {
			entryId: 1,
			timestamp: 0n,
			payload: new Uint8Array(8 * 3),
		};
		queue.queueStructRecord('Pose2d', pose2dRecord);
		expect(callback).toHaveBeenCalledTimes(0);

		queue.registerSchema('Pose2d', ['Translation2d', 'Rotation2d']);
		expect(callback).toHaveBeenCalledTimes(0);

		queue.registerSchema('Translation2d', []);
		expect(callback).toHaveBeenCalledTimes(0);

		queue.registerSchema('Rotation2d', []);
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith('Pose2d', [pose2dRecord]);
	});
});
