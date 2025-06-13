# Background Module Refactor

## Overview

This directory contains the modularized background logic for the Reclaim Browser Extension. The original monolithic `background.js` has been refactored into smaller, focused modules to improve maintainability, readability, and testability. All logging is now routed through a centralized debug logger for consistency.

---

## File Structure & Roles

- **background.js**
  - **Role:** Main entry point. Initializes the shared context object, wires up all modules, and registers Chrome event listeners. Delegates message handling to the message router.
  - **Responsibilities:**
    - Context setup (shared state and dependencies)
    - Listener registration (`chrome.runtime.onMessage`, tab removal, navigation events)
    - Orchestration of all background logic

- **messageRouter.js**
  - **Role:** Central message handler. Receives all messages from content scripts and routes them to the appropriate module based on action type.
  - **Responsibilities:**
    - Switch/case on message action
    - Delegation to session, tab, proof, or cookie modules
    - Uses `debugLogger` for all error/debug logs

- **sessionManager.js**
  - **Role:** Handles the session lifecycle, including starting, failing, and submitting verifications/proofs.
  - **Responsibilities:**
    - `startVerification`: Initiates a new verification session, opens provider tab, injects scripts, and sets up state
    - `failSession`: Handles session failure, updates status, and notifies content scripts
    - `submitProofs`: Submits generated proofs and handles post-submission tab logic
    - Uses `debugLogger` for all error/debug logs

- **tabManager.js**
  - **Role:** Manages browser tabs created by the extension, including script injection and tracking managed tabs.
  - **Responsibilities:**
    - `injectProviderScriptForTab`: Injects provider-specific scripts into tabs
    - `isManagedTab`/`removeManagedTab`: Utilities for managed tab tracking
    - Uses `debugLogger` for all error/debug logs

- **cookieUtils.js**
  - **Role:** Utility functions for fetching and filtering cookies relevant to requests.
  - **Responsibilities:**
    - `getCookiesForUrl`: Fetches cookies for a given URL, with domain/path/secure filtering
    - `shouldIncludeCookie`: Determines if a cookie should be included in a request
    - All warnings/errors are logged via the provided `debugLogger`

- **proofQueue.js**
  - **Role:** Manages the queue for proof generation, ensuring requests are processed sequentially and safely.
  - **Responsibilities:**
    - `addToProofGenerationQueue`: Adds proof generation tasks to the queue
    - `processNextQueueItem`: Processes the next queued proof, handles success/failure
    - Uses `debugLogger` for all error/debug logs

- **types.js**
  - **Role:** (Optional) Shared type definitions or interfaces for the background context and modules. Useful for documentation and TypeScript migration.

---

## Logging

All debug and error logs are routed through the `debugLogger` utility (using `DebugLogType.BACKGROUND`). This ensures consistent, filterable, and centralized logging for all background operations.

---

## Usage Notes

- The main context object (`ctx`) is passed to all modules and contains shared state, dependencies, and utility functions.
- All Chrome event listeners and orchestration logic are in `background.js`.
- Each module is responsible for a single area of concern, making the codebase easier to maintain and extend.

---

## Migration Summary

- **Monolithic `background.js` split into focused modules**
- **All logging standardized via `debugLogger`**
- **Improved maintainability, readability, and testability**

---

For further details, see the top of each module file for a summary of its responsibilities. 