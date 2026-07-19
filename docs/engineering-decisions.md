# Engineering Decisions

This document records the significant decisions made during Phase 0, the reasoning behind each, and the alternatives that were considered.

---

## Decision 1 — Investigate the codebase before reading the README

### Context

When encountering an unfamiliar repository, the instinct is often to read the README first. The README was deliberately skipped in favor of direct investigation.

### Decision

Investigate the repository structure, `package.json` files, entry points, and source files before reading any documentation.

### Reasoning

A README describes what the author intended. The source code describes what the application actually does. Reading code first builds an independent understanding that is not anchored to potentially outdated or incomplete documentation. It also develops the skill of reading unknown codebases — a skill that matters in professional engineering far more than following tutorials.

### Result

The technology stack, architecture, data flow, and authentication mechanism were all correctly identified through code inspection alone. The README added no new information.

---

## Decision 2 — Verify the application locally before touching infrastructure

### Context

The project goal involves Docker, Kubernetes, and CI/CD. There was no technical barrier to writing Dockerfiles immediately.

### Decision

Complete a full local verification of all three tiers before introducing any infrastructure technology.

### Reasoning

If a problem appears during containerization and the application has never been verified working without containers, it becomes impossible to know whether the problem is in the application or in the Docker configuration. Running locally first establishes a known-good baseline. Any future issue introduced by infrastructure can then be isolated with confidence.

This is standard engineering discipline — understand what you are wrapping before you wrap it.

### Tradeoff

This added time upfront. The tradeoff is reduced debugging time in every subsequent phase. The upfront cost is justified.

### Result

A fully verified baseline was established. All three tiers confirmed working. Authentication, JWT, database queries, and frontend rendering all verified before a single line of infrastructure code was written.

---

## Decision 3 — Derive the database schema from the application code

### Context

No database existed on the local machine. The schema needed to be created from scratch.

### Decision

Read the application source code to derive the exact schema rather than guessing or referencing external documentation.

### Reasoning

The application code is the authoritative source of truth for what schema it expects. The controllers reveal which columns are read and written. The model reveals the database name and connection details. Reading these files produces a schema that is guaranteed to match what the application needs.

### How it was done

- `api/models/db.js` → database name, host, credentials structure
- `api/app.js` → admin user insertion reveals column names
- `api/controllers/authController.js` → registration handler reveals the full column set
- `api/controllers/userController.js` → user queries reveal all accessed fields

### Result

Schema created on first attempt. No mismatch between application expectations and database structure.

---

## Decision 4 — Use the MySQL skip-grant-tables recovery procedure

### Context

MySQL was installed but the root password was unknown. Standard login attempts were rejected. The database could not be accessed.

### Decision

Use MySQL's built-in `--skip-grant-tables` recovery mechanism to reset the root password.

### Reasoning

This is the standard, documented MySQL recovery procedure. It is non-destructive — it does not delete data or alter the database structure. It temporarily bypasses authentication to allow administrative access, which is exactly the correct tool for this situation.

The alternative — reinstalling MySQL — would have been destructive and unnecessary.

### Result

Root access restored. Password set successfully. MySQL restarted normally with no data loss.

---

## Decision 5 — Test the API with curl before opening the browser

### Context

Once the API was running, it needed to be verified working before testing the full stack via the browser.

### Decision

Test the login endpoint directly via curl as an isolated, dependency-free verification step.

### Reasoning

Using curl to test the API removes the frontend as a variable. If the API returns a valid JWT from a curl request, the backend is confirmed working regardless of whether the frontend is running, configured correctly, or has any issues. It creates a clean separation between verifying the API and verifying the full stack.

### Result

API returned a valid JWT on the first curl request. Backend confirmed working independently before the frontend was started.

---

## Decision 6 — Accept the ESLint warning in UserDashboard.js without fixing it

### Context

The React compiler reported an ESLint warning: a missing dependency in a `useEffect` hook in `UserDashboard.js`.

### Decision

Document the warning and leave it unmodified for now.

### Reasoning

The warning is a code quality notice about a React hooks best practice. It does not cause a runtime error and does not affect the application's behavior. Fixing it would mean modifying application logic during an infrastructure verification phase. The scope of Phase 0 is verification, not code improvement. Modifying working application code introduces risk without benefit at this stage.

### Result

Application compiled and ran correctly. Warning noted for future code quality work.
