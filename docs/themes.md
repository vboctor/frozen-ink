# Themes

## Overview

VeeContext supports theming for the terminal UI dashboard, allowing users to customize the visual appearance to match their terminal environment and preferences.

## Default Theme

The default theme uses a minimal color palette designed for readability across light and dark terminal backgrounds:

- **Primary** - Used for headings and active elements
- **Secondary** - Used for borders and separators
- **Success** - Indicates successful sync operations
- **Warning** - Indicates stale data or slow syncs
- **Error** - Indicates failed sync operations or connectivity issues
- **Muted** - Used for timestamps and secondary information

## Custom Themes

Users can define custom themes in their configuration to override default colors and styles. Theme configuration supports:

- ANSI 256-color codes
- True color (24-bit) hex values
- Named terminal colors for portability

## UI Components

Themed components include:

- **Status indicators** - Sync health badges with color-coded states
- **Data tables** - Bordered tables for browsing context entries
- **Log viewer** - Scrollable log output with severity-based coloring
- **Progress bars** - Sync progress with animated indicators
