# Claude Code Development Guide

## Project Overview

This is a local web application for managing Azure DevOps work item processes across multiple organizations. It has a React frontend and Node.js/Express backend that wraps the Azure DevOps REST API.

## Architecture

```
backend/  (Node.js, CommonJS, Express 4)
  server.js              - Entry point, port 3001, mounts 4 route groups under /api
  routes/connections.js   - CRUD for org connections, PAT masking, connection testing
  routes/processes.js     - Process discovery, pull (fetches full WIT data in parallel), session/temp data
  routes/comparison.js    - Compares 2+ pulled processes (WITs, fields, states, behaviors) with granular property-level diffs
  routes/editor.js        - Preview (dry-run), apply (single), apply-batch (multi), direct edit endpoints for WITs/fields/states/behaviors
  services/azureDevOps.js - 48-method class wrapping Azure DevOps REST API v7.1 (processes, WITs, fields, states, rules, behaviors, layout)
  services/configManager.js - Reads/writes config/connections.json
  services/tempStorage.js   - Session-based temp JSON file management in temp/

frontend/  (React 19, Vite 6, ESM)
  vite.config.js         - Proxies /api/* to localhost:3001
  src/App.jsx            - Root component with 3 tabs: Connections, Discovery, Comparison
  src/index.css          - Global CSS design system (Azure-themed, no component library)
  src/services/api.js    - HTTP client wrapping all backend routes
  src/components/
    ConnectionManager/   - Add/edit/delete/test connections with PAT masking
    ProcessDiscovery/    - Select connection, list processes, pull, select for compare
    ProcessComparison/   - 5-tab visual diff (Summary, WITs, Fields, States, Behaviors) with inline editing actions

config/connections.json  - Persistent storage (contains PATs, gitignored content is sensitive)
temp/                    - Session temp files (gitignored)
```

## Key Design Decisions

- **No component library** -- uses plain CSS classes defined in `index.css`. All styling is class-based (`.card`, `.btn`, `.badge`, `.table-wrap`, etc.).
- **No TypeScript** -- plain JSX frontend, plain JS backend.
- **No router library** -- the frontend uses a simple `activeTab` state in App.jsx to switch between views.
- **CommonJS in backend** -- `require`/`module.exports`. The one exception is `node-fetch` v3 which is ESM-only, so `azureDevOps.js` uses dynamic `import('node-fetch')` inside `_fetch()`.
- **ESM in frontend** -- standard Vite/React ESM modules.
- **Comparison engine** is entirely server-side in `routes/comparison.js`. It loads pulled data from temp storage and runs pure JS comparison functions.
- **Inline editing on comparison screen** -- the ProcessComparison component provides inline actions (toggle field visibility, place fields on layout, create/delete WITs, add/remove fields and states) that call `editor.js` routes directly. The standalone Editor tab was removed.
- **Editor backend still used** -- `routes/editor.js` is called by the comparison screen for direct edits (e.g. `editControl` PATCH for visibility toggles, `addControl` PUT for layout placement). The batch `apply`/`preview` endpoints remain available.
- **Conflict handling** -- 409 on create = skip, 404 on delete/update = skip. Real errors are collected but don't stop the batch.

## Azure DevOps API

- All API calls go through `backend/services/azureDevOps.js`
- Base URL pattern: `{orgUrl}/_apis/work/processes/{processId}/...`
- API version: `7.1-preview.2` for most endpoints, `7.1-preview.1` for states/WIT behaviors/layout, `7.1` for org-level fields
- Auth: Basic auth with PAT (`:PAT` base64-encoded)
- Microsoft docs: https://learn.microsoft.com/en-us/rest/api/azure/devops/processes

## Running the App

```bash
npm run install:all   # Install root + backend + frontend deps
npm run dev           # Starts backend (3001) + frontend (3000) concurrently
```

Backend uses `node --watch` for auto-reload. Frontend uses Vite HMR.

## Testing Locally

There are no automated tests yet. To test manually:
1. Start with `npm run dev`
2. Open http://localhost:3000
3. Add a connection with a real Azure DevOps PAT
4. Test the connection, discover processes, pull, compare, edit

## Common Development Tasks

### Adding a new Azure DevOps API method
1. Add the method to `backend/services/azureDevOps.js` following the existing pattern
2. Add a backend route in the appropriate file under `backend/routes/`
3. Add the frontend API call in `frontend/src/services/api.js`
4. Wire it into the relevant React component

### Adding a new comparison dimension
1. Add a `compareX()` function in `backend/routes/comparison.js` following the pattern of `compareFields()` or `compareStates()`
2. Call it from `runComparison()` and include its diff count in the summary
3. Add a new tab or section in `frontend/src/components/ProcessComparison/ProcessComparison.jsx`

### Adding a new inline editing action
1. Add the handler in `ProcessComparison.jsx` calling the appropriate `editor.*` API method
2. Add the backend route in `routes/editor.js` if it doesn't exist (follow existing direct-edit pattern)
3. Add the API method in `services/azureDevOps.js` if needed
4. Call `refreshTempStorage()` after the edit so comparison data stays current

### Modifying the UI design
All CSS is in `frontend/src/index.css`. Key class groups:
- Layout: `.app`, `.app-header`, `.app-content`, `.app-nav`
- Cards: `.card`, `.card-header`
- Buttons: `.btn`, `.btn-primary`, `.btn-danger`, `.btn-sm`, `.btn-group`
- Forms: `.form-group`, `.form-row`
- Tables: `.table-wrap`, `table`, `th`, `td`
- Badges: `.badge`, `.badge-primary`, `.badge-success`, `.badge-danger`, `.badge-warning`
- Diff: `.diff-added`, `.diff-removed`, `.diff-changed`
- State categories: `.state-proposed`, `.state-inprogress`, `.state-completed`, `.state-removed`
- Modal: `.modal-overlay`, `.modal`, `.modal-header`, `.modal-body`, `.modal-footer`
- Notification: `.notification`, `.notification-info`, `.notification-success`, `.notification-error`

## Sensitive Files

- `config/connections.json` contains PATs in plaintext. Never commit real PATs.
- The `.gitignore` excludes `temp/`, `node_modules/`, and `.env`.
