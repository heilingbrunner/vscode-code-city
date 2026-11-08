# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Everything under [Unreleased] comes from a code review of the 0.0.1 codebase (findings plus follow-up tweaks).

## [Unreleased]

### Added
- Procedural building textures (facade styles `panels` / `windows` / `neon` + rooftops, generated on a canvas — no image assets); **Textures** toggle and **Facade** picker in the top bar, `panels` is the default
- **⤢ Fit** button in the top bar: zoom out to best-fit the whole city while keeping the current view direction; the city is auto-fitted when it first appears after a scan
- Tests for exclude globs, texture hashing and UV remapping (18 total)

### Changed
- Streets are dark gray in every color scheme, in both light and dark VS Code themes
- Directory "stair" slabs alternate gray / darker gray per nesting depth so the steps are visible
- Best-fit camera zoom now uses an exact projection of the city box corners (~36% closer than the old bounding-sphere fit)

### Fixed
- File watcher no longer triggers a full rescan for changes inside excluded folders (`node_modules`, `.git`, `dist`, …); watcher rebuilds when the settings change
- Webview scene rebuilds no longer leak materials/GPU objects
- Right-clicking a resource that was deleted before the handler runs no longer causes an unhandled rejection
- Scan results are deterministic (files processed in sorted path order)

## [0.0.1] - 2026-11-07

### Added
- Initial release: render the open folder as a 3D city — folder → district (squarified treemap), file → building (height = lines of code, linear/sqrt/log scale)
- Color buildings by LOC or by file extension; hover shows path + lines; click opens the file
- Project-type filtering (`Auto` detection, custom patterns, `All files`), ignored-folders and exclude globs, max file size setting
- City schemes (Berlin / London / Tokyo / Cairo) that follow the VS Code light/dark theme, soft sun shadows with toggle
