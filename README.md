# wpilog-parser

Read [WPILib data log (`.wpilog`)](https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html) files in TypeScript & JavaScript.

## Install

```bash
npm install wpilog-parser
```

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { readRecords, decodeRecords } from 'wpilog-parser';

const bytes = await readFile('./example.wpilog');

for (const record of decodeRecords(readRecords(bytes))) {
	console.log(record);
}
```

## Development

```bash
vp install
vp test
vp pack
```
