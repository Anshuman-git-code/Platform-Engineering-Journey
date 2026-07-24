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

---

## Phase 2 — Image Construction and Dockerfile Analysis

### On Docker Layers as Immutable Filesystem Snapshots

Before Phase 2, the mental model of a Docker image was vague — something between a zip file and a virtual machine. Phase 2A replaced that with a precise model: an image is a stack of immutable filesystem snapshots, where each snapshot represents the changes produced by one Dockerfile instruction.

This reframing changed everything. Instructions stopped being syntax to memorise and became filesystem transformation operations to reason about. The question shifted from "what does this instruction do?" to "what filesystem state does this instruction produce, and who depends on that state?"

Once layers are understood as immutable snapshots, the entire cache mechanism becomes obvious rather than magical. A cached layer is simply a stored snapshot. Docker reuses it when the input that produced it has not changed. Invalidation is not arbitrary — it follows the dependency chain of the snapshot stack.

---

### On Cache Invalidation — Input Changes, Not Instruction Changes

The most practically significant learning in Phase 2A was understanding exactly what Docker evaluates when deciding whether to use a cached layer.

The intuitive assumption — that Docker checks whether the instruction text changed — is incorrect. Docker evaluates whether the **input** to the instruction changed. For `COPY` instructions, the input is the content of the files being copied. For `RUN` instructions, the input is the filesystem state at that point, which is determined by all layers beneath it.

This distinction has a direct consequence on Dockerfile structure. An instruction that depends on a frequently-changing layer will itself be invalidated frequently — regardless of whether its own instruction text or direct inputs changed. The dependency chain propagates cache invalidation downward.

Understanding this made Dockerfile instruction ordering feel like dependency management rather than arbitrary convention. Stable inputs at the top. Volatile inputs at the bottom.

---

### On .dockerignore as a Security Boundary

`.dockerignore` was initially perceived as a file that speeds up builds by excluding large directories. The investigation that preceded introducing it revealed that this framing understates its importance significantly.

The most critical exclusion is `.env`. Without `.dockerignore`, every `docker build` embeds the current environment's credentials into the image layers. Image layers are permanent. Even if `.env` is deleted from the host after the build, the credentials remain embedded in the image and are accessible to anyone who can run the image. There is no way to remove a secret from a layer without rebuilding the image from scratch.

This is not a performance concern. It is a security requirement. Understanding `.dockerignore` as a security boundary — not a convenience feature — changes how seriously it is treated in every future Dockerfile.

---

### On the Build Time / Run Time Distinction

The separation between `RUN` (build time) and `CMD` (run time) initially seemed like a Docker technicality. Phase 2B analysis revealed it as a fundamental correctness boundary.

Instructions that execute during the build modify the image. Instructions that execute during the run start the application. Placing an application startup command in `RUN` would execute the application during the build — waiting for requests, blocking the build process, and producing a broken image.

This distinction maps directly to a broader engineering principle: building an artifact and executing an artifact are different operations with different concerns, different environments, and different failure modes. They must not be conflated.

---

### On `CMD` Exec Form and PID 1 Signal Handling

Choosing between shell form and exec form for `CMD` initially appeared to be a syntactic preference. The consequence of the choice — which process becomes PID 1 and therefore which process receives OS signals — makes it an engineering decision with operational impact.

Shell form makes the shell PID 1. The application becomes a child process. Graceful shutdown signals sent to the container reach the shell, which may or may not forward them to the application. Applications that implement graceful shutdown logic will not receive the signal. Containers may be forcibly killed after a timeout rather than shutting down cleanly.

Exec form makes the application PID 1. Signals reach it directly. Graceful shutdown works as intended.

This is another case where understanding the underlying mechanism — PID 1 and signal delivery, established in Phase 1 — makes a Dockerfile decision obvious rather than arbitrary.

---

### On Recognising the Same Pattern Across Technologies

Phase 2 reinforced a pattern observed in Phase 1: engineering decisions in Docker mirror engineering decisions in other systems.

Layer cache optimisation in Docker — stable inputs first, volatile inputs last — is the same principle as ordering database migrations, ordering build steps in a CI pipeline, and ordering Kubernetes resource creation. Stable dependencies before volatile ones. Things that rarely change before things that change frequently.

`.dockerignore` as a security boundary mirrors `.gitignore` for keeping secrets out of version control. The mechanism differs. The principle — explicitly declare what must be excluded to prevent accidental exposure — is identical.

Build time versus run time in Docker mirrors compile time versus runtime in compiled languages. Assets prepared in advance. Execution happens later. The artifact produced at build time is different from the process running at runtime.

Recognising these patterns means that each new technology requires less cognitive load. The engineering principles transfer. Only the syntax is new.

---

## Current Progress

**Phase 2A — Image Construction Concepts:** Complete.
All foundational concepts — layers, cache, build context, build vs run time, image design — documented and understood.

**Phase 2B — Backend Dockerfile Analysis:** In progress.
All Dockerfile instructions analysed: `FROM`, `WORKDIR`, `COPY package*.json`, `RUN npm install --only=production`, `COPY . .`, `.dockerignore`, `EXPOSE`, `CMD`.

Current stopping point: the engineering reasoning behind `FROM node:22-alpine` has been opened — specifically the three-component structure of the tag (`node`, `22`, `alpine`). The investigation into version selection strategy and the Alpine Linux engineering tradeoffs has been identified and scoped but not yet completed. That investigation continues in the next session.
