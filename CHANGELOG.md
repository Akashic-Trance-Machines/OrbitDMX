# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-29

### Added
- **Room Persistence**: Added the ability to save and load `.orbitdmx` room files via native File dialogs.
- **Autosave Engine**: Rooms are now automatically saved in the background with a 500ms debounce.
- **Undo/Redo Stack**: Added a 50-step history stack for room layouts, accessible via the Edit menu (`Cmd+Z` / `Cmd+Shift+Z`).
- **Physical Room View**: Added a new 2D interactive floor plan view where fixtures can be dragged and placed within user-defined room boundaries (in meters).
- **Floor Plan Rotation**: Fixtures on the floor plan can be rotated in 45° increments via right-click, represented by an orientation arrow.
- **Visual LED Feedback**: Floor plan fixtures dynamically render their current LED colours. Multi-LED fixtures (e.g. 4-LED RGBW pars) correctly display all LED states in a row layout.

### Changed
- **Fixture Control Panel Header**: Restructured the sidebar control panel to cleanly display the fixture title and setup icon alongside one another, with blackout and full-on actions positioned separately for clearer UX.
- **DMX Mode Setup**: Moved the fixture mode dropdown and start address configurations out of the active control panel into a dedicated "Edit Setup" modal to prevent accidental changes during live operation.

### Fixed
- **Address Overlap Detection**: Changing a fixture's DMX mode or start address now actively checks for channel overlaps and displays a visual warning if conflicts occur.
- **Universe Strip Visualization**: The universe strip at the bottom of the list view now renders overlapping fixture addresses in red, and visually indicates unused address gaps with a striped pattern.
