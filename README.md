# EA-CSC Records System

A responsive records-governance portal for the Engineering and Architecture
College Student Council.

## Current implementation

The project currently contains a static development screen and the initial
source-folder structure. Authentication, records storage, review, publication,
bulletins, and turnover workflows are not implemented yet.

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
