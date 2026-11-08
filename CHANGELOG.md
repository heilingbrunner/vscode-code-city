# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.3]

### Changed
- File types panel (left sidebar) reworked: wider panel (176px → 240px) and longer bars (max 100px → 170px) for better scaling
- File type bars are now decoupled from their label and scale with the square root of the share of the largest type, so small counts (e.g. 2 files) get visibly smaller bars than 72 / 109 / 715 instead of all clamping to the same width
- File extensions in the panel show their full name in black on the colored bar (no more 8-character "..." truncation)
- Removed the "Code City" title from the top bar — the editor tab already shows it

## [0.0.2]

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

## [0.0.1] - 2026-11-08

### Added
- Initial release: render the open folder as a 3D city — folder → district (squarified treemap), file → building (height = lines of code, linear/sqrt/log scale)
- Color buildings by LOC or by file extension; hover shows path + lines; click opens the file
- Project-type filtering (`Auto` detection, custom patterns, `All files`), ignored-folders and exclude globs, max file size setting
- City schemes (Berlin / London / Tokyo / Cairo) that follow the VS Code light/dark theme, soft sun shadows with toggle
