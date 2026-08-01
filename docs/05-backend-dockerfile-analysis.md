# Phase 2B — Backend Dockerfile Analysis

## Approach

Phase 2B applies the conceptual foundation established in Phase 2A to the actual Dockerfile present in the `api/` directory of this repository. The analysis proceeds instruction by instruction, documenting the engineering problem each instruction solves before examining the instruction itself.

The Dockerfile under analysis:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .
EXPOSE 5000
CMD ["node", "app.js"]
```

Each instruction is examined as an engineering decision — what problem it solves, why it was written this way, and what the consequence of an alternative approach would be.

---

## FROM

### The Problem

A container needs a complete execution environment. An application cannot run in a vacuum. It requires an operating system filesystem, system libraries, a language runtime, and a package manager. Building this from scratch for every application image would be impractical and produce inconsistent results.

### The Engineering Decision

Reuse an existing, production-ready, officially maintained base image that provides the operating system and runtime in a single layer.

```dockerfile
FROM node:22-alpine
```

The `FROM` instruction declares the base image — the starting layer on top of which all subsequent instructions build. Every image has exactly one `FROM` instruction, and it defines the foundation of the entire image.

Official images published by language maintainers (such as the Node.js Docker team) are preferred for several reasons:

- They are maintained and updated by the runtime's own team
- They receive security patches on a regular cadence
- They follow established conventions for the runtime's filesystem layout
- They are verified and audited before publication to Docker Hub
- They eliminate the risk of misconfigured or insecure base environments

Using an unofficial or custom base image introduces maintenance burden and security uncertainty that is not justified when an official image exists.

### Breaking Down `node:22-alpine`

This single argument contains three distinct engineering decisions:

| Component | Value | Engineering Decision |
|---|---|---|
| Registry prefix | *(none — implies Docker Hub official)* | Use the official Docker Hub registry |
| Image name | `node` | Use the official Node.js image |
| Tag | `22-alpine` | Use Node.js version 22 on Alpine Linux |

The tag `22-alpine` contains two pieces of information: the Node.js major version (`22`) and the Linux distribution variant (`alpine`).

**Version selection and Alpine investigation are deliberately left for the next learning session.** The full reasoning behind pinning to version 22 and the engineering tradeoffs of Alpine Linux versus other base distributions — including size, compatibility, and available system packages — will be examined in depth when version strategy and image size optimisation are covered.

What is established at this point: `FROM` is not a boilerplate line. It is the most significant single decision in a Dockerfile because every subsequent instruction builds on top of it. The base image determines the operating system, the available system utilities, the runtime version, and the starting image size.


---

## WORKDIR

### The Problem

When Docker executes instructions inside the image filesystem, every command runs relative to a current working directory. Without explicitly setting one, instructions execute from the root of the filesystem (`/`). Writing application files into the root directory creates several problems:

- Application files pollute the root filesystem alongside system directories (`/bin`, `/etc`, `/usr`)
- File collisions with system files become possible
- The location of application files becomes unpredictable
- Debugging and inspection inside a running container becomes difficult

### The Engineering Decision

Create a dedicated, isolated directory for the application and set it as the working directory for all subsequent instructions.

```dockerfile
WORKDIR /app
```

`WORKDIR` creates the specified directory if it does not exist and sets it as the working directory for all subsequent `RUN`, `COPY`, `ADD`, and `CMD` instructions. It is the container equivalent of `mkdir /app && cd /app` — but it persists as the working context for the entire remainder of the build.

The name `/app` is a widely adopted convention for application working directories in Docker images. It is not enforced by Docker — any path would work — but `/app` clearly communicates intent and is immediately recognisable to any engineer reading the Dockerfile.

All subsequent `COPY` instructions that use `.` as the destination reference `/app`. When `docker exec` is used to enter a running container, the shell opens in `/app`. The application's startup command in `CMD` executes from `/app`.

---

## COPY package*.json ./

### The Problem

The application has two categories of files: dependency manifests (`package.json`, `package-lock.json`) and application source code (controllers, routes, models, `app.js`). These two categories have fundamentally different rates of change.

Dependency manifests change only when a dependency is added, removed, or updated — which happens infrequently relative to source code changes.

Application source code changes on every development iteration.

If both categories are copied together before dependencies are installed, then every source code change invalidates the dependency installation layer. npm reinstalls all packages on every build regardless of whether any dependency changed. On a project with hundreds of dependencies, this adds minutes to every build.

### The Engineering Decision

Copy only the dependency manifests first, before installing dependencies, to isolate the dependency installation layer and allow it to be cached independently of source code changes.

```dockerfile
COPY package*.json ./
```

**The wildcard `package*.json`** matches both `package.json` and `package-lock.json`. This is intentional:

- `package.json` declares the dependency list and version ranges
- `package-lock.json` locks the exact resolved versions for reproducible installs

Both files must be present for `npm install` to produce a deterministic result. Copying only `package.json` and omitting `package-lock.json` would cause npm to resolve versions independently on each build, potentially installing different dependency versions than those tested against.

The destination `./` refers to the current `WORKDIR` — `/app`. Both files are copied into `/app/`.

The cache behavior this produces:

- If neither file has changed since the last build → this layer is a cache hit → `RUN npm install` is also a cache hit → build proceeds from source copy
- If either file has changed → cache is invalidated from this point forward → dependencies are reinstalled → source is copied

This is the layer cache optimisation described in Phase 2A applied to a real Dockerfile.


---

## RUN npm install --only=production

### The Problem

The application's dependencies must be installed inside the image. They cannot be copied from the host machine's `node_modules` because:

- The host `node_modules` may have been installed on a different operating system (macOS) with native bindings compiled for that OS
- Copying macOS-compiled native modules into a Linux container produces broken binaries
- The host `node_modules` may be out of sync with `package-lock.json`
- Copying `node_modules` from the host bypasses the reproducibility guarantee that `package-lock.json` provides

Dependencies must be installed inside the image, against the image's operating system and architecture, during the build.

### The Engineering Decision

Run dependency installation as a build-time instruction, producing a fully populated `node_modules` inside the image.

```dockerfile
RUN npm install --only=production
```

`RUN` executes a command during image construction and commits the resulting filesystem changes as a new layer. The `node_modules` directory populated by `npm install` becomes part of the image — permanently present in every container created from it.

**Why this belongs at build time and not run time:**

The alternative would be to run `npm install` as part of the `CMD` — installing dependencies every time a container starts. This approach is poor engineering for several reasons:

- Every container start requires network access to the npm registry
- Container startup time increases from milliseconds to minutes
- If the npm registry is unavailable, the container fails to start
- The same dependencies are installed repeatedly across every container instance
- The installed dependencies are not the artifact that was tested — they are resolved fresh each time

`RUN npm install` installs dependencies once, during the build. Every container created from the image shares the same installed dependencies, already present in the image layers. The principle is build once, run many.

**The `--only=production` flag** instructs npm to install only `dependencies` from `package.json`, excluding `devDependencies`. Development tools — test runners, linters, type checkers — have no place in a production image. Excluding them reduces image size and eliminates tools that have no runtime purpose.

---

## COPY . .

### The Problem

The dependency manifests have been copied and dependencies have been installed. The application source code — controllers, routes, middleware, models, `app.js` — must now be present inside the image for the application to execute.

### The Engineering Decision

Copy the remaining application source files from the build context into the image's working directory.

```dockerfile
COPY . .
```

**Source (first `.`):** The build context root — the directory from which `docker build` was invoked. In this project, `docker build` is run from the `api/` directory. The build context therefore contains `app.js`, `controllers/`, `routes/`, `middleware/`, `models/`, and `package.json`.

**Destination (second `.`):** The current `WORKDIR` inside the image — `/app`. All files from the build context are copied into `/app/`.

This instruction is positioned after `RUN npm install` deliberately. Placing it here means that changes to source files only invalidate this layer and layers beneath it — the `COPY package*.json` and `RUN npm install` layers above remain cached. This is the layer cache strategy applied in practice.

**Host filesystem vs image filesystem:**

The files being copied exist on the host machine (macOS, in this project). After `COPY . .` executes, those files exist inside the image's Linux filesystem at `/app/`. The host filesystem and the image filesystem are completely separate. Modifying a source file on the host after the build has no effect on the image — the image must be rebuilt to incorporate changes.


---

## .dockerignore — Engineering Investigation

### The Problem

`COPY . .` copies everything from the build context into the image. In a real application project, the build context contains files that must never be in the image. This was identified through a deliberate investigation before `.dockerignore` was introduced.

**Files present in the `api/` build context that must not be in the image:**

| File or Directory | Problem |
|---|---|
| `node_modules/` | Installed for macOS — native bindings incompatible with Linux container. Overrides the clean `npm install` performed inside the image. Adds hundreds of megabytes unnecessarily. |
| `.env` | Contains database credentials and JWT secret. Copying secrets into an image embeds them permanently in the image layers. The image then carries live credentials that could be extracted by anyone with image access. |
| `.git/` | Version control history has no runtime purpose. Adds significant size. May expose repository history and contributor information. |
| `npm-debug.log` | Debug artifacts from the host development environment. No runtime purpose. |
| Temporary and OS files (`.DS_Store`) | macOS metadata files. No runtime purpose. Noise in the image filesystem. |

Each of these represents a different category of problem:
- `node_modules/` is an **OS compatibility** and **image size** problem
- `.env` is a **security** problem — the most critical
- `.git/` is an **image size** and **information exposure** problem
- Log and temp files are an **image hygiene** problem

### The Engineering Solution

`.dockerignore` instructs Docker to exclude specified files and directories from the build context before it is transmitted to Docker Engine. Files listed in `.dockerignore` are never available to any `COPY` instruction — they are excluded at the build context level, not the instruction level.

```
node_modules
.env
.git
npm-debug.log*
.DS_Store
```

The engineering significance of `.dockerignore` is not that it is a convenience feature. It is a **security boundary** and a **build correctness mechanism**.

Without excluding `node_modules`, the host-compiled modules overwrite the Linux-compiled modules installed by `RUN npm install`. The image may appear to build correctly but produces containers that fail at runtime when native modules are executed.

Without excluding `.env`, every `docker build` embeds the current environment's secrets into the image. Those secrets persist in the image layer permanently — they cannot be removed without rebuilding from scratch. If the image is pushed to a registry, the secrets are accessible to anyone who can pull the image.

`.dockerignore` was introduced only after identifying these specific problems. It is documented here as the engineering solution to those problems, not as a Docker configuration convention.


---

## EXPOSE

### The Problem

The API server listens on port 5000. A container running this image will have a process bound to port 5000 inside its network namespace. There is no mechanism inside the image itself to communicate this to the engineer running the container or to orchestration tools managing it.

### The Engineering Decision

Declare the port the application listens on as image metadata.

```dockerfile
EXPOSE 5000
```

`EXPOSE` does not publish the port. It does not create a port mapping. It does not make the application reachable from the host. Port mapping is a runtime concern, specified with `-p` during `docker run`.

`EXPOSE` is documentation embedded in the image. It communicates to engineers and to orchestration platforms (such as Kubernetes) which port the containerised application expects to receive traffic on. It is the image's way of declaring its network contract.

---

## CMD

### The Problem

The image contains the operating system, the runtime, the dependencies, and the application source code. Something must start the application process when a container is created from this image. That startup command must execute every time a new container starts — not once during the build.

### The Engineering Decision

Define the default command that executes when a container is started from this image.

```dockerfile
CMD ["node", "app.js"]
```

`CMD` executes at run time — when `docker run` creates a container from the image. It is not executed during `docker build`. No application starts, no port is opened, and no traffic is served during the build phase.

**The distinction between `RUN` and `CMD`:**

| Instruction | Executes | Purpose | Produces |
|---|---|---|---|
| `RUN` | Build time | Execute a command and commit filesystem changes as a layer | An image layer |
| `CMD` | Run time | Define the default process to start when a container is created | A running process (PID 1) |

`RUN node app.js` would execute the application during the build — waiting indefinitely for requests that never come, blocking the build permanently. This is a category error: applying a run-time instruction in a build-time context.

`CMD ["node", "app.js"]` records the startup command as image metadata. Every container created from this image starts by executing `node app.js`, which starts the Express server, establishes the MySQL connection, and begins serving requests.

The array syntax (`["node", "app.js"]`) is the exec form of `CMD`. It executes the command directly as PID 1 without wrapping it in a shell process. This is the correct form for application startup commands — the application process becomes PID 1 directly, receives OS signals correctly, and the container lifecycle is tied directly to the application process.

---

## Runtime vs Development Dependencies

### Engineering Problem

The instruction `RUN npm install --only=production` contains a flag that was examined without fully establishing the engineering reasoning behind it. The question is not what the flag does — npm's documentation covers that. The question is why a production image must contain only runtime dependencies, and what the cost of including development dependencies would be.

### Investigation

The `package.json` in any Node.js project contains two dependency categories:

**`dependencies`** — packages required at runtime. The application cannot execute without them.

| Package | Runtime Role |
|---|---|
| `express` | HTTP server framework — handles all incoming requests |
| `mysql2` | Database driver — all database communication passes through it |
| `bcryptjs` | Password hashing — used on every login and registration |
| `jsonwebtoken` | JWT signing and verification — used on every authenticated request |
| `cors` | Cross-origin request handling — active on every response |
| `dotenv` | Environment variable loading — executes on server startup |

**`devDependencies`** — packages required during development. They perform no function after deployment.

| Package Category | Examples | Production Role |
|---|---|---|
| Test runners | Jest, Mocha | None — tests do not run in production |
| Linters | ESLint | None — linting is a development activity |
| Formatters | Prettier | None — formatting is a development activity |
| Process managers | Nodemon | None — automatic restart on file change has no meaning in an immutable container |

### Engineering Decision

Install only `dependencies`. Exclude `devDependencies` from the production image.

### Engineering Reasoning

Including development dependencies in a production image produces measurable harm across multiple dimensions:

**Image size.** Development tooling — test frameworks, their transitive dependencies, type definitions — adds significant size to the image. Every megabyte added to the image is a megabyte transmitted on every pull and every deployment. At scale, this compounds.

**Attack surface.** Every package in the image is a potential vulnerability. Development packages are not maintained with the same production security standard as runtime packages. A vulnerability in a test runner or linter embedded in a production image creates risk that has no corresponding benefit — the package performs no function.

**Dependency graph complexity.** Development packages introduce their own transitive dependencies. A linter may pull in dozens of packages. Each is a potential source of vulnerabilities, license issues, and dependency conflicts. Excluding development dependencies reduces the total package surface to only what the running application requires.

**Build once, run many.** The production image is built once and deployed identically across environments. It should be the minimal, complete artifact required to run the application — nothing more. Development tooling is not part of that definition.

### Conclusion

`--only=production` is not an npm optimisation flag. It is the implementation of a production image design principle: the image contains exactly what the application requires to run, and nothing else. Every package excluded from the production image is a package that cannot be exploited, cannot be misconfigured, and does not increase the image size.

---

## Linux Networking Fundamentals

### Engineering Problem

Phase 2B documents `EXPOSE 5000` and port mapping as Docker concepts. Understanding them as Docker concepts is insufficient — it produces an engineer who knows Docker syntax but cannot reason about why networking behaves as it does when containers are involved.

The deeper question: when `app.listen(5000)` executes in the Node.js API, what actually happens? Who owns the port? Who receives packets?

### Investigation — The Linux Socket Lifecycle

Applications do not receive network packets directly. The Linux kernel owns all networking. Applications interact with the kernel through system calls, requesting the kernel to bind to a port and deliver packets to their process. The full execution path when `app.listen(5000)` executes is:

```
app.listen(5000)          — Express API call
        │
        ▼
Node.js Runtime           — translates to system call
        │
        ▼
socket()                  — kernel creates a socket file descriptor
        │
        ▼
bind()                    — kernel associates socket with port 5000
        │
        ▼
listen()                  — kernel marks port 5000 as accepting connections
        │
        ▼
Kernel Port Table         — port 5000 → Node.js process recorded
        │
        ▼
accept()                  — kernel delivers incoming connections to the process
```

The application never touches a packet. It makes a sequence of system calls. The kernel performs all packet reception, protocol handling, and delivery.

### The Linux Kernel Port Table

The Linux kernel maintains an internal port-to-process mapping. When a process successfully calls `bind()` and `listen()`, the kernel records the association:

```
Port     Process
─────────────────
5000  →  node (PID 847)
3306  →  mysqld (PID 412)
80    →  nginx (PID 201)
```

When a packet arrives at the network interface destined for port 5000, the kernel consults this table, finds the associated process, and delivers the data through the socket. The application wakes up, reads the data, and processes it. The packet routing is entirely a kernel responsibility.

### Why Two Processes Cannot Share One Port

Within a single network namespace, one IP address combined with one TCP port belongs to exactly one listening process. This is enforced by the kernel at the `bind()` system call.

When a second process attempts to call `bind()` on a port already registered in the kernel port table:

```
bind(5000)  →  EADDRINUSE  →  "Address already in use"
```

The kernel rejects the call. The second process cannot listen. The port is occupied.

This is not a Docker limitation. It is a kernel-level constraint on socket binding. The same constraint applies on bare metal, inside virtual machines, and inside containers — within the same network namespace.

### Engineering Significance

Understanding the kernel as the owner of networking changes how Docker port mapping is understood. Docker does not manage ports itself. Docker configures Linux kernel features — specifically, network namespaces and iptables rules — to control which port tables are consulted for which traffic. The abstraction Docker provides sits on top of these kernel primitives.

---

## Network Namespaces

### Engineering Problem

Phase 1 established that containers run in isolated network namespaces. Phase 2B introduced port mapping as the mechanism for bridging host and container networks. Neither fully addressed the underlying question: what is a network namespace, and why does it produce the isolation properties that containers depend on?

### Investigation

Docker does not create another operating system. Docker does not create another kernel. Docker instructs the Linux kernel to create an additional network namespace.

A network namespace is a complete, independent copy of the Linux networking stack. Each namespace contains:

```
Network Namespace
├── localhost (127.0.0.1)
├── Network interfaces (lo, eth0, ...)
├── Routing table
├── Firewall rules (iptables)
├── IP addresses
├── ARP table
└── Port table (independent of all other namespaces)
```

Every component of Linux networking that normally exists once on a machine exists independently within each namespace. Two namespaces do not share any networking state. They are completely isolated networking worlds, all managed by the same kernel.

When Docker creates a container, the kernel creates a new network namespace for that container. The container's processes execute within that namespace. Their socket calls — `bind()`, `listen()`, `connect()` — interact with the namespace's own port table, routing table, and interfaces. They are completely unaware of other namespaces.

### Independent localhost

This produces one of the most important conceptual clarifications in container networking.

`localhost` does not refer to the physical machine. `localhost` refers to the loopback interface of the current network namespace.

The consequence:

```
On the host machine:
  curl localhost:5000
  → queries host namespace port table
  → finds Node.js if running on host
  → no awareness of container processes

Inside a container:
  curl localhost:5000
  → queries container namespace port table
  → finds Node.js if running inside that container
  → no awareness of host processes
```

The commands are syntactically identical. The namespaces they query are completely different. The results are independent.

This explains a class of container networking confusion: a developer runs `curl localhost:5000` on the host machine while the API is running inside a container with no port mapping, and receives a connection refused error. The API is running and listening. The developer's curl is correct. The namespaces are simply not connected.

### Independent Port Tables

Each network namespace maintains its own independent port table. This is a direct consequence of the namespace isolation model.

```
Host Namespace Port Table          Container Namespace Port Table
──────────────────────────         ──────────────────────────────
5000  →  Host Node.js              5000  →  Container Node.js
3306  →  Host MySQL
```

Both the host and the container can have a process listening on port 5000 simultaneously. There is no conflict. The kernel routes each request to the port table of the namespace from which the request originated.

This is why multiple containers can all expose the same internal port — port 80 for three nginx containers, port 5000 for three API containers — without conflict. Each container's port 5000 entry exists in its own isolated port table. The kernel maintains them independently.

### Conceptual Shift

This investigation produced a fundamental shift in how Docker is understood.

Before this investigation, Docker appeared to be responsible for container networking — managing ports, handling isolation, routing traffic.

After this investigation, Docker is understood as software that configures existing Linux kernel features. Docker itself is the orchestration layer. The kernel provides the actual isolation primitives — namespaces, socket binding rules, routing tables. Docker's role is to invoke the kernel APIs that create and configure these structures, then manage their lifecycle.

```
docker run -p 8080:5000 api-image
        │
        ▼
Docker Engine
        │
        ├── Creates network namespace (kernel)
        ├── Creates container process in that namespace (kernel)
        ├── Configures iptables forwarding rule: 8080 → container:5000 (kernel)
        └── Manages lifecycle
```

The networking itself is entirely a kernel operation. Docker coordinates it.

---

## Virtual Ethernet — Introduction

### Engineering Problem

Network namespace isolation raises an immediate question: if a container's network is completely isolated within its own namespace, how do packets leave the container at all? Isolation that is total prevents both intrusion and communication. A container that cannot communicate is not useful.

### Investigation

The Linux kernel provides a networking primitive called a **virtual Ethernet pair** (veth pair). A veth pair behaves like a virtual Ethernet cable with two endpoints.

```
Host Namespace                    Container Namespace
──────────────                    ───────────────────

veth0 (host end)  ◄────────────►  eth0 (container end)
                    virtual
                    ethernet
                    cable
```

The two endpoints are created together and linked. A packet written into one endpoint immediately emerges from the other. The kernel handles this transfer internally — no physical network hardware is involved.

When Docker creates a container:
- The kernel creates a veth pair
- One endpoint remains in the host network namespace
- The other endpoint is moved into the container's network namespace, where it appears as `eth0`

From the container's perspective, `eth0` is a standard network interface. The process inside the container sends packets to `eth0` without any awareness that it is one end of a virtual cable whose other end exists in the host namespace.

This mechanism is how the isolation of network namespaces is preserved while still allowing controlled packet flow between namespaces. The namespace boundaries are intact. The veth pair provides an explicit, kernel-managed channel through those boundaries.

### Current Boundary

This investigation establishes the veth pair as the physical connectivity mechanism between namespaces. How Docker connects multiple container namespaces to each other — and how packets are routed between them — involves the Docker bridge network. That investigation is the immediate next topic and is documented separately when completed.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Dockerfile instruction analysis — `FROM` | Complete |
| Dockerfile instruction analysis — `WORKDIR` | Complete |
| Dockerfile instruction analysis — `COPY package*.json` | Complete |
| Dockerfile instruction analysis — `RUN npm install --only=production` | Complete |
| Dockerfile instruction analysis — `COPY . .` | Complete |
| `.dockerignore` investigation | Complete |
| Dockerfile instruction analysis — `EXPOSE` | Complete |
| Dockerfile instruction analysis — `CMD` | Complete |
| Runtime vs development dependency engineering reasoning | Complete |
| Linux networking fundamentals — socket lifecycle | Complete |
| Linux port table and kernel packet routing | Complete |
| Why two processes cannot share one port | Complete |
| Network namespaces — structure and isolation model | Complete |
| Independent localhost per namespace | Complete |
| Independent port tables per namespace | Complete |
| Docker as Linux kernel configuration layer | Complete |
| Virtual Ethernet pair — introduction | Complete |

### Remaining — Phase 2B Continuation

| Topic | Status |
|---|---|
| Docker Bridge Network | Pending |
| Packet journey: container to container | Pending |
| Container-to-container communication model | Pending |
| Docker Compose networking | Pending |
| Final practical image build | Pending |
| Image inspection | Pending |
| Backend container execution and verification | Pending |
| Debugging exercises | Pending |
| Engineering retrospective | Pending |

### Open Investigation

The engineering decisions behind `FROM node:22-alpine` — specifically version selection strategy and the Alpine Linux engineering tradeoffs (musl libc vs glibc, image size, available system packages) — remain open. This investigation is deferred until the current networking investigation is complete.
