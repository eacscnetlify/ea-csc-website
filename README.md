# EA-CSC Records System

A responsive records-governance portal for the Engineering and Architecture
College Student Council.

## Current implementation

The Batch 2 development prototype includes:

- A public catalog with debounced search and six-category filtering.
- Record details with current release information and permitted public history.
- A quick-view modal with keyboard controls and focus restoration.
- An officer workspace preview showing six fictional records, eight versions,
  three current public releases, and one sample turnover package.
- Separate displays for the latest working version and current public release.
- Loading, empty, unavailable-record, and error states with retry controls.
- Shared navigation, an officer sign-in placeholder, and a Page Not Found screen.

All information is fictional. The workspace preview is publicly accessible.
Authentication, position-based permissions, document storage, editing,
approval, release actions, and turnover acknowledgment are not connected.

Colors and layout are provisional.

## Setup environment

Initial setup used:

- Windows with PowerShell inside Visual Studio Code
- Node.js 24.22.1
- npm 11.19.1
- Git 2.56.0.windows.4
- Vite 8.3.5
- TypeScript 6.0.3
- Tailwind CSS and its Vite plugin 4.3.3

The package lockfile records the resolved dependency versions.

## Commands

Run commands from the project folder.

- `npm.cmd ci` — install the locked dependencies after obtaining a project copy
- `npm.cmd run dev` — start the development server
- `npm.cmd run lint` — run ESLint
- `npm.cmd run typecheck` — run TypeScript checks
- `npm.cmd run format` — format project files
- `npm.cmd run format:check` — check formatting
- `npm.cmd run build` — generate production files in dist
- `npm.cmd run preview` — serve the built files locally

Use the URL printed by the server. Press Ctrl+C to stop it.

## Source layout

- src/App.tsx — current development screen
- src/main.tsx — application entry point
- src/app — future application layout and routing
- src/components/ui — reusable interface components
- src/features — feature-specific screens and logic
- src/lib — shared utilities and service clients
- src/styles/global.css — shared styles and Tailwind import
- src/types — shared TypeScript definitions

## Toolchain compatibility

The generated starter requested TypeScript 7, while its typescript-eslint
dependency required TypeScript below 6.1. The project uses ~6.0.0 to resolve
that conflict. Check compatibility before changing these versions.

## Configuration and records

Local environment files are excluded from Git. Any future .env.example must
contain placeholders only.

Do not store real restricted records, backup exports, or credentials in the
source repository.

Git checkpoints preserve source code. They do not back up operational records.

## Development mock testing

While running the development server, the browser Session Storage setting
`ea-csc:mock-mode` supports:

- `normal`: usual fictional data.
- `slow`: delayed responses for checking loading messages.
- `empty`: empty service results.
- `error`: simulated request failures.

Change the setting under the origin matching the current development URL.
Changes affect subsequent requests. Restore `normal` after testing.

The normal production build ignores this setting.

## Batch 2 verification

Manual testing covered:

- Search, category filtering, and empty search results.
- Record details, permitted history, and unavailable record addresses.
- The request form remaining at public version 1 while working version 2
  is approved but unreleased.
- Modal mouse and keyboard controls, Escape, and focus restoration.
- Workspace totals and turnover package expansion.
- Loading, empty, error, and successful retry behavior.
- Navigation, refresh, and layouts at 375 and 1440 CSS pixels wide.

Formatting, TypeScript checking, ESLint, and the production build passed.
