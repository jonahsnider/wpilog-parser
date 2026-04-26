# Changelog

## [2.2.0](https://github.com/jonahsnider/wpilog-parser/compare/v2.1.0...v2.2.0) (2026-04-26)


### Features

* rename skill to analyze-wpilog ([5d399e6](https://github.com/jonahsnider/wpilog-parser/commit/5d399e602d1ec5e45fd1b6244dde1ea9afe490ab))

## [2.1.0](https://github.com/jonahsnider/wpilog-parser/compare/v2.0.0...v2.1.0) (2026-04-25)


### Features

* add graceful handling of corrupt log records ([1fd15cf](https://github.com/jonahsnider/wpilog-parser/commit/1fd15cf541c6234182a05f335095669c63deb321))
* include SKILL.md in npm package ([2bdf6f0](https://github.com/jonahsnider/wpilog-parser/commit/2bdf6f0816f4c68a43e39b81417b4267d55638b0))


### Bug Fixes

* fix catalogEntries() not normalizing names ([5c92e53](https://github.com/jonahsnider/wpilog-parser/commit/5c92e539cf20f13ebcef5e4fa2f857a3069e79d4))

## [2.0.0](https://github.com/jonahsnider/wpilog-parser/compare/v1.0.1...v2.0.0) (2026-04-17)


### ⚠ BREAKING CHANGES

* remove support for parsing streams

### Features

* remove support for parsing streams ([bd3fab7](https://github.com/jonahsnider/wpilog-parser/commit/bd3fab7014c740da3b4a2db2e71527d01f94e7a2))


### Bug Fixes

* fix return type of catalogEntries() ([26076c3](https://github.com/jonahsnider/wpilog-parser/commit/26076c3b77a8cc84763af5f2172b96f3b00e5ada))

## [1.0.1](https://github.com/jonahsnider/wpilog-js/compare/v1.0.0...v1.0.1) (2026-04-03)


### Bug Fixes

* rename to wpilog-parser ([1b3258d](https://github.com/jonahsnider/wpilog-js/commit/1b3258d52c9e0118ce51c7203c4349195a336291))

## 1.0.0 (2026-03-31)


### Features

* export DataRecord.ControlRecord types and isDataRecord helper ([c5b09fa](https://github.com/jonahsnider/wpilog-js/commit/c5b09faf8d860d2ca4bb3e6bc26ea28e2c1b19c7))
* initial implementation ([b02a841](https://github.com/jonahsnider/wpilog-js/commit/b02a8419351888bc1a25d930f1df829df3e26f32))
* support loading DataLog from buffer and iterating over just entry metadata ([1b4ea32](https://github.com/jonahsnider/wpilog-js/commit/1b4ea326484ac4d772d1834148203da7f90691d1))
