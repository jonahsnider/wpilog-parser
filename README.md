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

## Agent skill

This package ships an [Agent Skill](https://agentskills.io) at `skills/wpilog-parser/SKILL.md` that teaches AI coding agents how to use the library. Install it into your project with either:

```bash
# https://skills.sh/
npx skills add jonahsnider/wpilog-parser
```

```bash
# https://github.com/antfu/skills-npm
npx skills-npm
```

## Development

```bash
vp install
vp test
vp pack
```
