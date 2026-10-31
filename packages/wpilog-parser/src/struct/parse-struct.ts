import { parseStructSpecification as parseSharedSpecification } from 'wpilib-struct';
import { withStructDiagnostics } from './diagnostics.ts';

/** Parse a WPILib struct specification string into declarations. */
export function parseStructSpecification(declaration: string) {
	return withStructDiagnostics(() => parseSharedSpecification(declaration));
}
