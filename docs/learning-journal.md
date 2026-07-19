# Learning Journal

This document records genuine observations, realizations, and understanding developed during Phase 0. It is written as an honest account of what was learned, not as a polished summary.

---

## On Reading Unknown Codebases

The most important realization from Phase 0 is that reading an unfamiliar codebase is a skill, and like any skill it has a repeatable method.

The method is:
1. Read the folder structure — it communicates intent
2. Read `package.json` — it reveals the technology stack precisely
3. Read the entry point — it reveals how the application is wired together
4. Follow the imports — they map the dependencies between components
5. Read the route and controller files — they reveal what the application actually does

This sequence can identify the complete architecture of a JavaScript application in under 15 minutes without running a single command.

---

## On the Difference Between Language and Framework

A `.js` file extension only tells you the programming language is JavaScript. It tells you nothing about what the code does or what framework it uses.

Two completely different applications can both be written in `.js` files:
- A React component and an Express route handler are both `.js` files
- The distinction comes entirely from the dependencies

This matters because when approaching an unfamiliar repository, assumptions based on file extension alone will mislead you. Always read `package.json` first.

---

## On Three-Tier Architecture

The application's separation into three tiers is not a cosmetic choice. Each boundary between tiers serves a real engineering purpose.

The frontend has no database access. This is not a limitation — it is a security property. A user inspecting network requests from the browser can never directly query the database because the API sits between them. The API validates every request before it reaches the database.

The API is stateless. It holds no memory of previous requests. Authentication state lives in the JWT, which the client owns and sends with every request. This means the API can be scaled horizontally — any instance can handle any request because no instance stores session data. This is a property that becomes critical in Kubernetes, where multiple replicas of the API will run simultaneously.

Understanding why the architecture is designed this way — not just what it looks like — is what enables correct infrastructure decisions in later phases.

---

## On the Value of Local Verification

Running the application locally before containerizing it might seem like extra work. It is the opposite.

When Docker is introduced, new variables enter the picture — network namespaces, volume mounts, environment variable injection, image layering, port mapping. If the application has not been verified working without those variables, any problem that appears cannot be attributed to a specific cause.

Local verification converts "the application might not work" from an unknown risk into a resolved fact. Everything after this point starts from a known-good foundation.

---

## On MySQL Configuration

MySQL 9.x ships with a password validation policy enabled by default. Passwords must meet minimum complexity requirements. This is a security default that did not exist in older versions and is not always mentioned in tutorials written for earlier MySQL releases.

This is a real-world behavior difference between environments. The EC2 instance running Ubuntu and an older MySQL version accepted the simpler password. The local macOS machine running MySQL 9.3 via Homebrew rejected it. This kind of environment-specific behavior is exactly why infrastructure needs to be explicit and version-pinned — a lesson that will be applied when writing Dockerfiles.

---

## On the JWT Authentication Model

The JWT is signed with a secret key stored in `api/.env`. The token contains the user's ID and role. The backend does not store any session information.

When the frontend sends a request, it attaches the JWT in the Authorization header. The backend's `auth.js` middleware verifies the signature and extracts the payload. The `role.js` middleware then checks the role against the required permission for that endpoint.

This means authentication and authorization are both enforced at the API level on every request, regardless of what the frontend does. The frontend adjusts the UI based on role (showing or hiding buttons) but this is a usability feature, not a security feature. The security lives in the API.

This distinction matters when thinking about containerization — the JWT secret will need to be injected as an environment variable into the API container without being baked into the image.

---

## On the Admin Seeding Pattern

The API auto-creates an admin user on startup if one does not exist. This is implemented in `app.js` and runs every time the server starts.

This pattern is useful for development and for first-time deployments — it ensures a usable admin account exists without requiring manual database intervention. In a production Kubernetes deployment, this behavior needs to be considered carefully. If multiple API replicas start simultaneously, the seeding logic needs to be idempotent (which it is — it checks for existence before inserting) to avoid race conditions or duplicate entry errors.

The existing implementation handles this correctly because it queries first, then conditionally inserts. This is worth noting before horizontal scaling is introduced.

---

## Phase 0 — Closing Observation

Phase 0 produced no Dockerfiles, no YAML, no pipeline configuration. It produced something more valuable for this stage: a complete, accurate understanding of the application.

That understanding is what makes every subsequent infrastructure decision well-informed rather than guessed.
