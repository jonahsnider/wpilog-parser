# wpilog-parser

Read and write [WPILib data log (`.wpilog`)](https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html) files in TypeScript & JavaScript.

## Install

```sh
npm install wpilog-parser
```

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { parseDataLog } from 'wpilog-parser';

const bytes = await readFile('./example.wpilog');

for (const record of parseDataLog(bytes)) {
	console.log(record);
}
```

`parseDataLog()` is the preferred API for fully decoded records. It reads and decodes the file in one pass, avoiding the intermediate record allocations made by composing `readRecords()` and `decodeRecords()`.

Use `readRecords()` and `decodeRecords()` separately when you need access to raw records or want to transform the record stream before decoding it. Both approaches produce the same decoded records.

Struct schemas are compiled lazily into reusable decoders, and struct payloads are returned as plain objects, including nested structs and arrays of structs.
In environments where Content Security Policy blocks runtime code generation, decoding falls back to a CSP-safe implementation.

### Writing logs

```ts
import { writeFile } from 'node:fs/promises';
import { DataLogWriter } from 'wpilog-parser';

const writer = new DataLogWriter();
const speed = writer.start('/drive/speed', 'double');
writer.addStructSchema('Translation2d', 'double x;double y');
writer.addStructSchema('Rotation2d', 'double value');
writer.addStructSchema('Pose2d', 'Translation2d translation;Rotation2d rotation');
const pose = writer.start('/drive/pose', 'struct:Pose2d');

writer.append(speed, 1.5, 20_000);
writer.append(pose, { translation: { x: 1, y: 2 }, rotation: { value: 0.5 } }, 20_000);

await writeFile('./example.wpilog', writer.flush());
```

`append()` encodes a value for the entry's type. It accepts the same payloads that `parseDataLog()` returns, and `int64` values can also be safe integer numbers. Other types, such as `raw`, take a `Uint8Array`.
Add every struct schema an entry uses, including nested ones, with `addStructSchema()` before appending to the entry.

Timestamps are integer microseconds. When a timestamp is omitted, the writer uses a monotonic clock counting from the JavaScript time origin.

`flush()` returns the bytes written since the previous call, starting with the file header. To write a log while a program runs, append each flushed chunk to a file; the concatenated chunks form a complete log.

A summary of the full API is available in [wpilog-parser.api.md](https://github.com/jonahsnider/wpilog-parser/blob/main/packages/wpilog-parser/etc/wpilog-parser.api.md).

## CLI

List every entry available in a log before writing an analysis script:

```sh
npx wpilog-parser catalog ./example.wpilog
```

The default output is [TOON](https://toonformat.dev). JSON, JSONL/NDJSON, and CSV are also supported:

```sh
npx wpilog-parser catalog ./example.wpilog --json
```

`wpilog` includes shell completions via `wpilog complete`:

```sh
# zsh
source <(wpilog complete zsh)

# bash (requires bash 4+ and bash-completion)
source <(wpilog complete bash)

# fish
wpilog complete fish > ~/.config/fish/completions/wpilog.fish

# PowerShell
wpilog complete powershell | Out-String | Invoke-Expression
```

## Agent skill

This package ships an [Agent Skill](https://agentskills.io) at `skills/analyze-wpilog/SKILL.md` that teaches AI coding agents how to use the library.
It allows agents to analyze robot log files themselves, and create reports or insights based on the data stored in the WPILOG.

You can also install the skill with:

```sh
# https://skills.sh/
npx skills add jonahsnider/wpilog-parser
```

With [pnpm 12.11.0 or later](https://pnpm.io/agent-skills), install the package and approve its skill:

```sh
pnpm add wpilog-parser
pnpm approve
```

Approving skills for `wpilog-parser` records the following in your project's `pnpm-workspace.yaml`:

```yaml
permissions:
  wpilog-parser:
    skills: true
```
