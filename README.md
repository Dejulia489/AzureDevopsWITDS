# Azure DevOps Work Item Process Manager

A local web application for managing Azure DevOps work item processes across multiple organizations. Discover, compare, edit, and synchronize work item process configurations using the Azure DevOps REST API.

## Features

- **Connection Management** -- Store and manage connections to multiple Azure DevOps organizations with PAT authentication
- **Process Discovery** -- Pull full process configurations including work item types, fields, states, rules, behaviors, and layouts
- **Visual Comparison** -- Side-by-side comparison of processes across organizations with granular diff highlighting
- **Live Editing** -- Edit work item types, fields, states, and behaviors directly in the browser
- **Change Preview** -- Dry-run preview of all pending changes before applying
- **Batch Apply** -- Apply the same set of changes to multiple processes at once
- **Conflict Handling** -- Graceful handling of conflicts (duplicate creates are skipped, missing deletes are skipped)

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- An Azure DevOps organization with a [Personal Access Token (PAT)](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) that has **Work Items (Read & Write)** and **Process (Read & Write)** scopes

## Quick Start

```bash
# Install all dependencies (root, backend, and frontend)
npm run install:all

# Start both backend and frontend in development mode
npm run dev
```

The frontend opens at **http://localhost:3000** and the backend API runs on **http://localhost:3001**.

### Dev Container

This repository includes a [dev container](.devcontainer/devcontainer.json) configuration for VS Code / GitHub Codespaces. Open the repo in VS Code and choose **Reopen in Container** -- dependencies install automatically via `postCreateCommand`.

## Project Structure

```
├── backend/                      # Node.js Express API server
│   ├── server.js                 # Express app entry point (port 3001)
│   ├── routes/
│   │   ├── connections.js        # CRUD + test for org connections
│   │   ├── processes.js          # Process discovery and pull
│   │   ├── comparison.js         # Multi-process comparison engine
│   │   └── editor.js             # Preview, apply, batch apply, direct edits
│   └── services/
│       ├── azureDevOps.js        # Azure DevOps REST API wrapper (48 methods)
│       ├── configManager.js      # Reads/writes config/connections.json
│       └── tempStorage.js        # Session-based temp file management
├── frontend/                     # React + Vite single-page application
│   ├── index.html
│   ├── vite.config.js            # Vite config with API proxy to :3001
│   └── src/
│       ├── App.jsx               # Root component with tab navigation
│       ├── index.css             # Global design system (Azure-themed)
│       ├── services/
│       │   └── api.js            # Frontend HTTP client for all backend routes
│       └── components/
│           ├── ConnectionManager/ # Add, edit, delete, test connections
│           ├── ProcessDiscovery/  # List processes, pull data, select for compare
│           ├── ProcessComparison/ # Side-by-side visual diff with tabs
│           ├── ProcessEditor/     # Edit WITs, fields, states, behaviors
│           └── ChangePreview/     # Dry-run modal with apply confirmation
├── config/
│   └── connections.json          # Persistent connection storage
└── temp/                         # Session temp files (gitignored)
```

## Usage Guide

### 1. Add a Connection

Navigate to the **Connections** tab and click **Add Connection**. Provide:

| Field | Description |
|-------|-------------|
| **Name** | A friendly label (e.g. "Production Org") |
| **Organization URL** | `https://dev.azure.com/your-org` |
| **PAT** | A Personal Access Token with Work Items and Process read/write scopes |

Click **Save**, then **Test** to verify connectivity. PATs are stored locally in `config/connections.json` and masked in the UI (only the last 4 characters are shown).

### 2. Discover and Pull Processes

Switch to the **Discovery** tab:

1. Select a connection from the dropdown
2. The app lists all inherited processes in that organization
3. Click **Pull** on any process to fetch its full configuration (work item types, fields, states, rules, behaviors, and layout)
4. Pulled data is cached in the `temp/` directory for the session

Each pull fetches data for every work item type in parallel for speed.

### 3. Compare Processes

In the **Discovery** tab, check two or more pulled processes and click **Compare Selected**. The app switches to the **Comparison** tab showing:

| Tab | What it shows |
|-----|---------------|
| **Summary** | High-level counts of differences by category |
| **Work Item Types** | Presence/absence of each WIT across processes |
| **Fields** | Per-WIT field comparison with property-level diffs (name, type, casing, required, default value) |
| **States** | Per-WIT state comparison with category and color diffs |
| **Behaviors** | Process-level and WIT-level behavior assignment diffs |

Differences are highlighted with color coding:
- Green = present / added
- Red = missing / removed
- Yellow = property mismatch

Use the **Show only differences** toggle on the Fields and States tabs to filter to mismatches.

### 4. Edit a Process

Navigate to the **Editor** tab and select a pulled process:

- **Work Item Types** -- View all WITs in a table. Click a row to select it. Add new WITs or queue existing ones for removal.
- **Fields** -- For the selected WIT, view all fields. Add existing org-level fields from a dropdown or create entirely new fields. Queue fields for removal.
- **States** -- For the selected WIT, view all states with their categories and colors. Add new states or queue existing ones for removal.

Changes are queued locally (shown with colored badges) and are not sent to Azure DevOps until you explicitly apply them.

### 5. Preview and Apply Changes

When you have pending changes (shown as a badge count in the editor toolbar):

1. Click **Preview Changes** to see a dry-run summary of every operation
2. Review warnings (e.g. "removing a field may fail if it's in use by rules")
3. Click **Apply Changes** to execute against Azure DevOps
4. View results: applied, skipped (already exists / not found), and errors

To apply the same changes across multiple processes, click **Apply to Multiple** and select target processes from the modal.

## API Reference

All backend routes are prefixed with `/api`.

### Connections

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/connections` | List all connections (PATs masked) |
| `GET` | `/api/connections/:id` | Get a single connection |
| `POST` | `/api/connections` | Create a connection (`{ name, orgUrl, pat }`) |
| `PUT` | `/api/connections/:id` | Update a connection |
| `DELETE` | `/api/connections/:id` | Delete a connection |
| `POST` | `/api/connections/:id/test` | Test a connection returns `{ success, message }` |

### Processes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/processes/:connectionId` | List all processes for a connection |
| `GET` | `/api/processes/:connectionId/:processId` | Get process summary (from temp if available) |
| `POST` | `/api/processes/:connectionId/:processId/pull` | Pull full process data from Azure DevOps |
| `GET` | `/api/processes/:connectionId/:processId/data` | Get stored/pulled process data |
| `GET` | `/api/processes/:connectionId/fields/all` | Get all organization-level fields |
| `GET` | `/api/processes/session/data` | Get all session temp data |
| `DELETE` | `/api/processes/temp/all` | Clear all temp data |
| `DELETE` | `/api/processes/temp/:connectionId/:processId` | Clear specific temp data |

### Comparison

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/comparison/compare` | Full comparison of 2+ processes |
| `POST` | `/api/comparison/compare/summary` | Summary-only comparison |

**Request body:**
```json
{
  "processes": [
    { "connectionId": "uuid", "processId": "guid" },
    { "connectionId": "uuid", "processId": "guid" }
  ]
}
```

### Editor

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/editor/preview` | Dry-run preview of changes |
| `POST` | `/api/editor/apply` | Apply changes to a single process |
| `POST` | `/api/editor/apply-batch` | Apply changes to multiple processes |

**Direct edit endpoints** (immediate single-operation mutations):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/editor/:connId/:procId/workitemtype` | Create a work item type |
| `PATCH` | `/api/editor/:connId/:procId/workitemtype/:witRef` | Update a work item type |
| `DELETE` | `/api/editor/:connId/:procId/workitemtype/:witRef` | Delete a work item type |
| `POST` | `/api/editor/:connId/:procId/:witRef/field` | Add a field |
| `PATCH` | `/api/editor/:connId/:procId/:witRef/field/:fieldRef` | Update a field |
| `DELETE` | `/api/editor/:connId/:procId/:witRef/field/:fieldRef` | Remove a field |
| `POST` | `/api/editor/:connId/:procId/:witRef/state` | Create a state |
| `PATCH` | `/api/editor/:connId/:procId/:witRef/state/:stateId` | Update a state |
| `DELETE` | `/api/editor/:connId/:procId/:witRef/state/:stateId` | Delete a state |
| `POST` | `/api/editor/:connId/:procId/:witRef/behavior` | Add a behavior to a WIT |
| `PATCH` | `/api/editor/:connId/:procId/:witRef/behavior/:behId` | Update a WIT behavior |
| `DELETE` | `/api/editor/:connId/:procId/:witRef/behavior/:behId` | Remove a WIT behavior |

## Azure DevOps API Coverage

The backend wraps the [Azure DevOps Work Item Tracking Process REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/processes) (version 7.1). Supported resource types:

| Resource | Operations |
|----------|------------|
| **Processes** | List, Get, Create |
| **Work Item Types** | List, Get, Create, Update, Delete |
| **Fields** | List (per WIT), Add, Update, Remove; List (org-level) |
| **States** | List, Create, Update, Delete, Hide/Unhide |
| **Rules** | List, Create, Update, Delete |
| **Behaviors** | List, Get, Create, Update, Delete |
| **WIT Behaviors** | List, Add, Update, Remove |
| **Layout** | Get full layout, Pages (CRUD), Sections (Create/Delete), Groups (CRUD, Move) |

## Data Storage

| What | Where | Persistence |
|------|-------|-------------|
| Connections (org URLs + PATs) | `config/connections.json` | Permanent (across sessions) |
| Pulled process data | `temp/*.json` | Session-only (gitignored) |

No external database is required. The `config/connections.json` file is the only persistent storage and contains sensitive PAT tokens -- do not commit it to a shared repository.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start both backend and frontend concurrently |
| `npm run dev:backend` | Start only the backend (port 3001, with `--watch` for auto-reload) |
| `npm run dev:frontend` | Start only the frontend (port 3000, Vite dev server) |
| `npm run install:all` | Install dependencies for root, backend, and frontend |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6 |
| Backend | Node.js, Express 4 |
| API Client | node-fetch 3 |
| Dev Container | Node.js 22 (mcr.microsoft.com/devcontainers/javascript-node:22) |

## Error Handling

The application is designed to handle failures gracefully:

- **API errors** are caught per-operation during batch apply. The process continues even if individual operations fail.
- **409 Conflict** (item already exists) is treated as a skip, not an error.
- **404 Not Found** on delete/update operations is treated as a skip.
- **Connection failures** show clear error messages in the UI notification bar.
- **Partial pulls** -- if fetching fields or states fails for a single WIT, the pull continues for remaining WITs with a console warning.

## License

Private -- see repository settings.
