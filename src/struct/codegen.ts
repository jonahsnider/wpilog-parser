import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCstDts } from 'chevrotain';
import { parser } from './parser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, 'generated.d.ts');

const productions = parser.getGAstProductions();
const dts = generateCstDts(productions);

writeFileSync(OUTPUT_PATH, dts);
