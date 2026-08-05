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

---

## Phase 2 — Containerization Decisions

## Decision 7 — Design the image requirements before writing any Dockerfile instruction

### Context

Phase 2B began with an existing Dockerfile in `api/`. Before analysing or modifying it, the engineering exercise was to independently identify what the image must contain — without looking at the file.

### Decision

Derive the complete image requirements from application knowledge before examining any Dockerfile syntax.

### Reasoning

Writing or reading a Dockerfile without first understanding what the image needs produces instructions that are accepted without comprehension. Identifying requirements independently — Linux OS, Node.js runtime, npm, dependency manifests, source code, startup command — creates a standard against which the actual Dockerfile can be evaluated. It transforms reading a Dockerfile from passive consumption into active engineering assessment.

### Result

Every instruction in the backend Dockerfile was accounted for by the pre-derived requirements. No instruction was encountered without understanding its purpose.

---

## Decision 8 — Separate dependency installation from source code copying

### Context

A Dockerfile must copy application files and install dependencies. The order of these operations determines cache behavior.

### Decision

Copy dependency manifests (`package.json`, `package-lock.json`) first, run `npm install`, then copy all remaining source files.

### Reasoning

Dependency manifests change rarely. Source files change on every development iteration. Placing dependency installation before source copy means the `npm install` layer remains cached across all source-only changes. This reduces build time from minutes to seconds for the common case of incremental source changes.

### Tradeoff

The Dockerfile has more instructions than a naive implementation. This is an acceptable tradeoff — the structural overhead is fixed and the performance benefit compounds across every build.

### Result

Incremental builds execute `npm install` only when dependency manifests change. All other builds hit the cache and proceed directly to source copy.

---

## Decision 9 — Use --only=production flag for npm install

### Context

`package.json` contains both `dependencies` (runtime) and `devDependencies` (development tools — linters, test runners, type checkers).

### Decision

Install only production dependencies in the image using `npm install --only=production`.

### Reasoning

Development tools serve no purpose in a running container. Including them increases image size and introduces packages that are not needed, not tested for production use, and represent unnecessary attack surface. The image should contain only what is required to run the application.

### Result

Image contains only the runtime dependency tree. Development tools are excluded.

---

## Decision 10 — Introduce .dockerignore before building the image

### Context

`COPY . .` copies the entire build context. The `api/` directory contains `node_modules/`, `.env`, `.git/`, and other files that must not be in the image.

### Decision

Create `.dockerignore` before executing the first build, listing all files and directories that must be excluded from the build context.

### Reasoning

Three distinct problems were identified that made this a requirement rather than an optimisation:

1. `node_modules/` compiled for macOS would override the Linux-compiled modules installed inside the image, producing runtime failures with native modules.
2. `.env` contains live database credentials and JWT secrets. Embedding them in an image layer makes them permanently accessible to anyone with image access.
3. `.git/` and log files increase image size with files that have no runtime purpose.

### Result

Build context excludes all non-application files. Image contains only what is required. Secrets are not embedded in image layers.

---

## Decision 11 — Use CMD exec form rather than shell form for application startup

### Context

`CMD` can be written in two forms: shell form (`CMD node app.js`) or exec form (`CMD ["node", "app.js"]`).

### Decision

Use exec form for the application startup command.

### Reasoning

Shell form wraps the command in `/bin/sh -c`, making the shell process PID 1 rather than the application. The application becomes a child process of the shell. This means OS signals (SIGTERM for graceful shutdown) are sent to the shell, not the application. Graceful shutdown handling in the application is bypassed.

Exec form executes the command directly as PID 1. The application receives signals correctly and the container lifecycle is tied directly to the application process.

### Result

`node app.js` runs as PID 1. The container stops when and only when the Node.js process exits. Signal handling works as the application expects.

---

## Phase 2B — Backend Containerization Decisions

## Decision 12 — Use the official Node.js image rather than a generic Linux base

### Context

The backend requires Node.js, npm, and a Linux operating system. One approach is to start from a generic Linux base image (such as `ubuntu` or `alpine`) and install Node.js manually. The other is to start from the official `node` image maintained by the Node.js Docker team.

### Decision

Use `FROM node:22-alpine` — the official Node.js image — as the base for the backend image.

### Reasoning

The official Node.js image is built and maintained by the Node.js release team. It receives security patches on the same cadence as Node.js releases. It follows established conventions for filesystem layout and runtime configuration. The entrypoint, environment variables, and installed tooling are verified before publication.

Starting from a generic Linux base and installing Node.js manually introduces maintenance burden with no corresponding benefit: the engineer becomes responsible for tracking Node.js security releases, installing the correct version for the target architecture, configuring the environment correctly, and keeping the installation current. The official image eliminates all of these concerns.

### Result

Base image provides a verified, maintained Node.js runtime. All subsequent instructions build on a known-good foundation.

---

## Decision 13 — Accept Alpine Linux as the base distribution

### Context

The `node` image is available in multiple Linux distribution variants: `node:22` (Debian Bookworm), `node:22-slim` (Debian minimal), and `node:22-alpine` (Alpine Linux). Each variant presents different tradeoffs.

### Decision

Use `node:22-alpine` for the backend image.

### Reasoning

Alpine Linux produces significantly smaller images than Debian variants. The Alpine base filesystem is approximately 9MB; the Debian equivalent is substantially larger. For a backend service deployed across multiple environments, image size directly affects pull times, registry storage costs, and deployment speed.

### Tradeoffs

Alpine uses musl libc rather than glibc. Some native Node.js modules that compile against glibc will fail to install or run on Alpine. The backend in this project uses `bcryptjs` (pure JavaScript, no native compilation) and `mysql2` (pure JavaScript driver). Neither requires glibc. Alpine is appropriate for this specific dependency set.

If the backend were to introduce native modules that require glibc, the base image decision would need to be revisited. The tradeoff is documented here so that any future change to the dependency list is evaluated against this constraint.

### Result

Backend image is approximately 257MB total (including the Node runtime). A Debian-based image would be significantly larger for equivalent functionality.

---

## Decision 14 — Separate dependency manifest copy from application source copy

### Context

The Dockerfile must copy files from the build context and install npm dependencies. Both operations can be done in a single step (`COPY . .` followed by `RUN npm install`) or in two separate steps.

### Decision

Copy only `package.json` and `package-lock.json` first, run `npm install`, then copy all remaining source files.

```dockerfile
COPY package*.json ./
RUN npm install --only=production
COPY . .
```

### Reasoning

Application source files change on every development iteration. Dependency manifests change only when a dependency is added, removed, or updated — which is infrequent relative to source changes.

If source files and dependency manifests are copied together in a single step, any source file change invalidates the copy layer and therefore invalidates the `npm install` layer. npm reinstalls all packages on every build regardless of whether any dependency changed.

Separating the two copy operations creates a stable layer boundary. The `npm install` layer is cached against the dependency manifest inputs. It is invalidated only when `package.json` or `package-lock.json` changes — not when application source changes.

### Result

`npm install` executes exactly once across all incremental source builds. Cache hits on the dependency layer reduce build time from minutes to seconds for the common case.

---

## Decision 15 — Install only production dependencies in the image

### Context

`package.json` declares both `dependencies` (runtime) and `devDependencies` (development tooling: linters, test runners, formatters, process managers).

### Decision

Use `npm install --only=production` (or `--omit=dev` in newer npm versions) to install only runtime dependencies.

### Reasoning

Development tooling has no function after deployment. Including it in the production image produces measurable harm:

- **Image size**: development packages and their transitive dependencies add unnecessary storage overhead
- **Attack surface**: every package in the image is a potential vulnerability; packages that perform no runtime function should not be present
- **Dependency graph**: development packages introduce their own transitive dependencies, none of which are needed for the application to operate

The production image should contain exactly what is required to run the application. Every package excluded is a package that cannot be exploited and does not increase storage cost.

### Result

Image contains 99 production packages. Development tooling is absent from the production image.

---

## Decision 16 — Treat .dockerignore as a security boundary, not an optimisation

### Context

`COPY . .` copies the entire build context into the image. The `api/` directory contains files that must not be in the image: `node_modules/` (host-compiled, OS-incompatible), `.env` (live credentials), `.git/` (version control history), and macOS metadata files.

### Decision

Create `.dockerignore` before executing the first build and treat it as a required security control, not an optional performance enhancement.

### Reasoning

The consequences of omitting `.dockerignore` are not uniform. They span two distinct risk categories:

**Correctness risk**: `node_modules/` compiled on macOS contains binaries built for the macOS architecture and system libraries. Copying them into a Linux container causes native modules to fail at runtime. The image may build successfully and produce a container that fails in ways that are difficult to diagnose.

**Security risk**: `.env` contains the database password and JWT secret. Once embedded in an image layer, credentials are permanently part of that image. They cannot be removed by deleting the `.env` file — the layer is immutable. Anyone with access to the image can extract the credentials. If the image is pushed to a registry, the credentials become accessible to anyone who can pull it.

The `.env` exclusion is not a convenience. It is a requirement for any image that may be stored in or distributed via a registry.

### Result

Build context excludes host-compiled modules, credentials, version control history, and OS metadata. Image layers contain only application code and Linux-compiled dependencies.

---

## Decision 17 — Use exec-form CMD for application startup

### Context

Docker's `CMD` instruction supports two forms:
- Shell form: `CMD node app.js` — executed as `/bin/sh -c "node app.js"`
- Exec form: `CMD ["node", "app.js"]` — executed directly

### Decision

Use exec form: `CMD ["node", "app.js"]`.

### Reasoning

Shell form makes `/bin/sh` PID 1. The Node.js process becomes a child of the shell. OS signals sent to the container — including `SIGTERM` for graceful shutdown — are delivered to the shell process, not to the application. The shell may not forward signals to its children. Graceful shutdown logic implemented in the Node.js application is bypassed. The container is forcibly killed after the timeout rather than shutting down cleanly.

Exec form makes `node` the direct PID 1 (the entrypoint script ultimately `exec`s the Node process). Signals are delivered to the application. Graceful shutdown works as intended. The container lifecycle is tied directly and transparently to the application process.

### Result

`node app.js` receives OS signals correctly. Container shutdown is clean. Container lifetime is transparently tied to the application process.

---

## Decision 18 — Treat EXPOSE as documentation, not networking configuration

### Context

The backend API listens on port 5000. The Dockerfile includes `EXPOSE 5000`. It would be reasonable to assume this instruction makes the port accessible.

### Decision

Treat `EXPOSE` as metadata documentation only. Never rely on it for networking configuration.

### Reasoning

`EXPOSE` performs no kernel operations. It does not call `bind()`, install iptables rules, or register any entry in the host port table. It records the application's intended listening port in the image configuration JSON, where it is readable by engineers and by orchestration tools such as Kubernetes.

The application becomes reachable only when an explicit port publishing rule exists — either `-p` at runtime or a `ports` mapping in Docker Compose. That rule installs forwarding entries in the host networking stack. `EXPOSE` is the declaration of intent. `-p` is the implementation.

Understanding this distinction prevents a class of debugging errors where an application appears to be configured correctly because `EXPOSE` is present, but is unreachable because no publishing rule exists.

### Result

Port publishing is always specified explicitly at runtime. The networking intent is documented in the Dockerfile via `EXPOSE`. These are treated as independent concerns.

---

## Decision 19 — Separate runtime debugging from image construction investigation

### Context

Phase 2B involved both image construction (Dockerfile analysis, build process, layer inspection) and runtime behavior (container execution, port publishing, process inspection, failure analysis).

### Decision

Treat image construction and runtime debugging as distinct engineering domains requiring separate mental models and separate diagnostic tools.

### Reasoning

Image construction problems manifest during `docker build`. Runtime problems manifest during `docker run`. The failure signatures are completely different:

- A build failure means the image was not produced. The fix lives in the Dockerfile or the build context.
- A runtime failure means the image was produced but the container did not behave as expected. The fix may lie in the CMD, in missing environment variables, in network configuration, or in the application logic itself.

Conflating the two leads to searching for build-time fixes for runtime problems and vice versa. The layered debugging model — image/build, container runtime, networking, application logic, external services — provides the framework for isolating which domain contains the failure.

### Result

Build failures and runtime failures were consistently diagnosed at the correct layer throughout Phase 2B. No time was spent modifying the Dockerfile in response to application logic failures, and no time was spent debugging networking when the issue was in the CMD instruction.

---

## Phase 3 — Frontend Containerization Decisions

## Decision 20 — Use a multi-stage build for the frontend image

### Context

The React frontend requires Node.js, npm, and all development dependencies to build. It requires only Nginx and the static build output to run. These two requirement sets share no components.

### Decision

Use a two-stage Dockerfile: Stage 1 (builder) installs dependencies and runs the build tool; Stage 2 (runtime) starts from a clean Nginx image and copies only the build output.

### Reasoning

A single-stage Dockerfile that satisfies both requirements would include Node.js, npm, `node_modules` (~300MB), and React source code in the production image. None of these are needed at runtime. They increase image size, add packages that represent potential vulnerabilities, and provide no operational benefit.

Multi-stage builds allow the build environment and the runtime environment to be completely independent. The final image contains only what the running container needs: Nginx and the static files it serves.

### Result

Production image size approximately 25–30MB versus 600MB+ for an equivalent single-stage image. No Node.js runtime, no source code, and no development dependencies in production.

---

## Decision 21 — Use npm ci instead of npm install for the build stage

### Context

The build stage must install JavaScript dependencies. Both `npm install` and `npm ci` install packages, but with different guarantees about reproducibility.

### Decision

Use `npm ci` in the Dockerfile instead of `npm install`.

### Reasoning

`npm install` reads `package.json` version ranges and may install newer versions than the developer tested if they satisfy the range. It may modify `package-lock.json`. This behavior is acceptable in development. In a production build it is not — it allows the Docker build to install untested dependency versions.

`npm ci` reads exclusively from `package-lock.json` and installs the exact recorded versions. It never modifies the lockfile. If `package.json` and `package-lock.json` are inconsistent, it fails immediately rather than resolving silently. Every build from the same lockfile produces identical installed packages.

### Tradeoff

`npm ci` deletes `node_modules` and reinstalls from scratch rather than updating in place. This makes it slightly slower on the first run but faster in CI environments due to the elimination of resolution overhead.

### Result

Every Docker build installs the exact dependency set that was tested during development. The lockfile is the production contract.

---

## Decision 22 — Use Nginx to serve the frontend instead of Node.js

### Context

After `npm run build` completes, the frontend is a set of static files: HTML, CSS, JavaScript bundles, and assets. Something must serve them over HTTP.

### Decision

Use Nginx as the runtime server for the frontend container.

### Reasoning

Static file serving requires no application logic, no language runtime, and no dynamic processing. Nginx is purpose-built for this task. It reads a file from disk and returns it over HTTP with minimal overhead.

Running a Node.js runtime to serve static files introduces a JavaScript engine, an event loop, and associated runtime overhead — none of which perform any work in this context. Nginx uses significantly less memory, serves files faster, and handles more concurrent connections for this use case.

### Result

Frontend runtime container is lightweight. Container memory footprint is a fraction of an equivalent Node.js file server. Nginx handles static file serving correctly without any application code.

---

## Decision 23 — Run Nginx with daemon off to maintain PID 1

### Context

Nginx by default starts as a daemon: the initial process forks worker processes and then exits. In a Docker container, PID 1 exiting causes the container to stop immediately.

### Decision

Use `CMD ["nginx", "-g", "daemon off;"]` to prevent Nginx from daemonizing.

### Reasoning

Docker monitors PID 1. When PID 1 exits, Docker considers the container's work complete and stops it. Nginx's default daemon behavior would cause PID 1 to exit immediately after forking workers, stopping the container before it serves a single request.

`daemon off;` instructs Nginx to remain in the foreground as PID 1. The same PID 1 principle that governs the backend CMD — exec form to ensure the application process is PID 1 and receives OS signals — applies identically to Nginx.

### Result

Nginx remains as PID 1. The container runs as long as Nginx runs. Container lifetime is correctly tied to the web server process.

---

## Phase 4 — Docker Compose Decisions

## Decision 24 — Describe infrastructure declaratively rather than imperatively

### Context

Running a three-service application with Docker CLI requires five or more correctly sequenced commands. Any omission or ordering error produces a failure that may be difficult to diagnose. Two developers executing the sequence independently may produce different infrastructure states.

### Decision

Describe the complete application infrastructure in a `docker-compose.yml` file and use `docker compose up` as the single command to start the system.

### Reasoning

Declarative infrastructure is reproducible. The file is version-controlled alongside application code. Every developer who checks out the repository and runs `docker compose up` receives an identical environment. The infrastructure is no longer a procedure in a README — it is a machine-readable specification.

This is the same principle applied by Kubernetes manifests, Terraform configurations, and CloudFormation templates. The mental model and the discipline established with Docker Compose apply directly to all of them.

### Result

One command starts the complete three-tier application. Environment consistency across developer machines is guaranteed by the file.

---

## Decision 25 — Use image: for MySQL, build: for first-party services

### Context

The application requires three containers: MySQL, the Node.js backend, and the React frontend. MySQL is a third-party database with an officially maintained image. The backend and frontend are developed in this repository.

### Decision

Use `image: mysql:8` for MySQL. Use `build: ./api` and `build: ./client` for the backend and frontend respectively.

### Reasoning

MySQL's source code is not in this repository and should not be. The MySQL team maintains a production-grade image that is regularly updated, security-patched, and documented. Using `image:` consumes that work directly.

The backend and frontend contain application-specific code that must be compiled into images from source. `build:` triggers `docker build` against the respective Dockerfile, producing an image tailored to the application's requirements.

### Result

Third-party services are consumed as published images. First-party services are built from source. Each category uses the correct mechanism.

---

## Decision 26 — Separate service names from container names

### Context

Compose assigns both a service name (for DNS and `depends_on`) and a container name (for CLI operations). The project sets explicit `container_name:` values.

### Decision

Keep service names and container names consistent in this project for clarity, but understand and document them as separate concerns.

### Reasoning

Service names are the DNS identity — they are what other services use in `DB_HOST`, `depends_on`, and inter-container communication. Container names are the CLI handle — they are what `docker logs`, `docker exec`, and `docker stop` use.

Setting `container_name:` makes CLI operations predictable without relying on generated names. However, explicit `container_name:` prevents horizontal scaling of that service because two containers cannot share a name. This tradeoff is acceptable for a development environment. Production deployments that require scaling would remove `container_name:` and let Compose generate unique names per replica.

### Result

CLI operations use predictable names. The distinction between service identity and container identity is documented for future scaling considerations.

---

## Decision 27 — Use a named volume for MySQL data persistence

### Context

MySQL stores database files at `/var/lib/mysql`. Without a volume, this data is lost when the container is removed.

### Decision

Mount a named volume (`mysql-data`) at `/var/lib/mysql`.

### Reasoning

Containers are ephemeral. The writable layer of a container is deleted when the container is removed. Mounting a named volume at the database storage path moves the data outside the container lifecycle. The volume persists through `docker compose down` and is available when a new MySQL container starts.

A named volume is preferred over a bind mount for database storage because Docker manages its lifecycle independently of the host filesystem layout. It is portable across machines and does not depend on a specific host directory path.

### Result

Database contents survive container removal and restart. `docker compose down` and `docker compose up` do not lose data. `docker compose down -v` is required to explicitly remove the volume and reset the database.

---

## Decision 28 — Use depends_on for startup ordering, not readiness

### Context

The backend must connect to MySQL. If the backend starts before MySQL is accepting connections, `ECONNREFUSED` occurs.

### Decision

Use `depends_on` to establish startup ordering. Do not rely on it for readiness guarantees.

### Reasoning

`depends_on` guarantees that the MySQL container is started before the backend container. It does not guarantee that MySQL has finished initializing and is accepting connections. This distinction is documented explicitly.

The correct solution for readiness is either health checks (Docker-side) or connection retry logic (application-side). Retry logic is more portable and is the standard production approach.

### Result

Startup ordering is deterministic. Readiness is handled at the application level. The distinction between "container started" and "application ready" is preserved as an engineering principle.

---

## Decision 29 — Separate configuration from code via environment variables

### Context

The backend requires database credentials, a JWT secret, and other configuration values. These values differ between environments.

### Decision

Supply all environment-specific configuration via `environment:` in the Compose file. The application reads values from `process.env`. No configuration values are hardcoded in application source code.

### Reasoning

This is the 12-Factor App configuration principle: strict separation between code and configuration. The same Docker image can be deployed to any environment by changing the environment variables supplied to it. The image itself does not need to be rebuilt for different environments.

In this project, credentials are in the Compose file for development convenience. Production environments would source these values from `.env` files, Docker secrets, or a secrets manager — keeping the application code unchanged.

### Result

Application code is environment-agnostic. Configuration is supplied at deployment time. The same image runs in development, staging, and production with different configurations.

---

## Phase 5 — Kubernetes Foundations Decisions

## Decision 30 — Understand cluster architecture before writing any Kubernetes YAML

### Context

Kubernetes YAML manifests reference components — Deployments, Services, Pods, ReplicaSets — whose purpose cannot be correctly understood without first understanding the cluster architecture they operate within.

### Decision

Follow the same methodology used for Docker: establish the engineering problem and architectural model before introducing any implementation syntax.

### Reasoning

A Deployment manifest written without understanding the Desired State model, the Scheduler, and the kubelet is a manifest written by memorization. When it fails — and it will fail — there is no mental model to debug from. Understanding the architecture first means every YAML field has a known reason for existing.

### Result

Every Kubernetes concept introduced in Phase 5 was derived from an engineering problem rather than presented as a feature to memorize.

---

## Decision 31 — Separate the Control Plane from Worker Nodes

### Context

Kubernetes requires a decision-making component (Control Plane) and execution components (Worker Nodes) to be on separate machines.

### Decision

Document and accept this architectural separation as a fundamental engineering constraint, not as operational overhead.

### Reasoning

Combining Control Plane and Worker responsibilities on the same machines produces all four failure modes identified during the Phase 5 analysis: split-brain scheduling conflicts, resource blindness, N×N communication overhead, and inability to coordinate global operations. The separation is the engineering solution to those problems, not a complexity imposed by Kubernetes.

### Result

The Control Plane makes cluster-wide decisions without being affected by the resource consumption of workloads. Worker Nodes execute workloads without making cluster-wide scheduling decisions.

---

## Decision 32 — Use the Desired State model as the primary mental model for Kubernetes

### Context

Kubernetes can be approached as a collection of YAML resources to memorize or as a system built around one central idea.

### Decision

Use the Desired State / Actual State reconciliation model as the primary framework for understanding every Kubernetes component.

### Reasoning

Every Kubernetes component — Scheduler, Controller Manager, kubelet — is an implementation of the same loop: observe actual state, compare to desired state, take action to reconcile. Understanding this single model explains why self-healing works, why scaling works, and why rolling updates work — without needing to understand each feature independently.

### Result

Kubernetes becomes a coherent system rather than a list of features. Debugging Kubernetes problems becomes a question of "which component's reconciliation loop is failing?" rather than "which command do I run?"
