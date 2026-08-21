# wpilog-parser

Read [WPILib data log (`.wpilog`)](https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html) files in TypeScript & JavaScript.

## Install

```sh
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

## CLI

List every entry available in a log before writing an analysis script:

```sh
npx wpilog-parser catalog ./example.wpilog
```

The default output is [TOON](https://toonformat.dev). JSON, JSONL/NDJSON, and CSV are also supported:

```sh
npx wpilog-parser catalog ./example.wpilog --json
```

## Agent skill

This package ships an [Agent Skill](https://agentskills.io) at `skills/analyze-wpilog/SKILL.md` that teaches AI coding agents how to use the library. Install it into your project with either:

```sh
# https://skills.sh/
npx skills add jonahsnider/wpilog-parser
```

```sh
# https://github.com/antfu/skills-npm
npx skills-npm
```

## Development

```sh
vp install
vp test
vp pack
```
