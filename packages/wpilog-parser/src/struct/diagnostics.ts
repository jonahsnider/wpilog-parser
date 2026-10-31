import { StructError } from 'wpilib-struct';
import { diagnostics } from '../diagnostics.ts';

/** Preserve the published WPILOG diagnostics at the protocol boundary. */
export function withStructDiagnostics<T>(action: () => T): T {
	try {
		return action();
	} catch (error) {
		if (!(error instanceof StructError)) throw error;
		switch (error.code) {
			case 'STRUCT_R0007':
				throw diagnostics.WPILOG_R0007({ cause: error.cause });
			case 'STRUCT_R0008':
				throw diagnostics.WPILOG_R0008({ cause: error.cause });
			case 'STRUCT_R0009':
				throw diagnostics.WPILOG_R0009();
			case 'STRUCT_R0010':
				throw diagnostics.WPILOG_R0010({
					type: error.details.type!,
					width: error.details.width!,
					maxBits: error.details.maxBits!,
				});
			case 'STRUCT_R0011':
				throw diagnostics.WPILOG_R0011();
			case 'STRUCT_R0012':
				throw diagnostics.WPILOG_R0012({ name: error.details.name! });
			case 'STRUCT_R0013':
				throw diagnostics.WPILOG_R0013({ name: error.details.name! });
		}
	}
}
