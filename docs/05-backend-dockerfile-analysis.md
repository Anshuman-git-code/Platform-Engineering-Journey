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

This investigation establishes the veth pair as the physical connectivity mechanism between namespaces. How Docker connects multiple container namespaces to each other — and how packets are routed between them — involves the Docker bridge network, documented in the following section.

---

## Docker Bridge Network

### Engineering Problem

Each container has a veth pair connecting its namespace to the host namespace. For a single container, this is sufficient — the host end of the veth pair can be managed directly. For multiple containers, direct veth management scales poorly. Ten containers produce ten separate veth endpoints in the host namespace, with no mechanism for the containers to communicate with each other.

### Investigation — The Mesh Problem

Consider the alternative: direct connections between every container that needs to communicate with every other. For five containers, that requires ten direct links. For ten containers, forty-five. For fifty, 1225. The topology becomes unmanageable.

```
Direct connection model (does not scale)

Backend ──── Frontend
   │    \   /    │
   │     \ /     │
   │      X      │
   │     / \     │
   │   /    \    │
MySQL ──── Redis
```

Physical networks solved this problem decades ago with the Ethernet switch: one central device that every host connects to, which forwards frames to the correct destination based on MAC address.

### The Docker Bridge

Docker creates a virtual Ethernet switch — a bridge device — that every container's veth endpoint connects to. This bridge is visible on the host as a network interface, typically named `docker0` for the default bridge or a generated name for user-defined networks.

```
Docker Bridge (Virtual Ethernet Switch)
          docker0 — 172.18.0.1
               │
    ┌──────────┼──────────┐
    │          │          │
  veth1      veth2      veth3
    │          │          │
   eth0       eth0       eth0
    │          │          │
 Backend    Frontend    MySQL
172.18.0.2  172.18.0.3  172.18.0.4
```

Every container plugs into the same bridge. The bridge forwards Ethernet frames between containers exactly as a physical switch forwards frames between machines on a LAN. Containers on the same bridge network can reach each other through the bridge without any traffic leaving the host.

### IP Address Allocation

The bridge network operates with its own IP subnet. Docker assigns IP addresses from this subnet to each container when it starts.

A typical default bridge allocation:

| Host / Container | IP Address |
|---|---|
| Bridge (`docker0`) | 172.18.0.1 |
| Backend container | 172.18.0.2 |
| Frontend container | 172.18.0.3 |
| MySQL container | 172.18.0.4 |

Docker manages this allocation. The container processes are unaware of the allocation mechanism — they simply find a configured `eth0` interface when they start.

### Engineering Significance

The bridge network answers the scalability question raised by veth pairs. Individual veth cables provide the physical connectivity between namespaces. The bridge provides the switching fabric that connects all containers into a coherent network without requiring direct links between every pair. The two mechanisms are complementary: veth pairs are the cables, the bridge is the switch.

---

## Packet Journey — Browser to Application

### Engineering Problem

Each networking component has been examined in isolation. The engineering value of those individual investigations is realised when they are assembled into a complete, end-to-end model of how a single request travels from a browser to an application running inside a container.

### Complete Request Path

The scenario: a browser on the host machine requests `http://localhost:5000`. The Node.js API is running inside a container started with `docker run -p 5000:5000`.

```
Browser
  │
  │  GET http://localhost:5000
  ▼
Host TCP/IP Stack
  │
  │  Destination: localhost:5000
  │  Consults host namespace port table
  │  Port 5000 not registered to a host process
  │  Docker port publishing rule exists: host:5000 → container:5000
  ▼
Docker Port Mapping (iptables rule installed by Docker Engine)
  │
  │  Packet redirected to bridge network
  ▼
Docker Bridge (docker0)
  │
  │  Bridge consults forwarding table
  │  Destination IP: container 172.18.0.2
  ▼
veth pair
  │
  │  Packet transmitted through virtual cable
  ▼
Container eth0
  │
  │  Packet enters container network namespace
  ▼
Container Linux Kernel
  │
  │  Destination: port 5000
  │  Consults container namespace port table
  │  Port 5000 → Node.js process
  ▼
Node.js (PID 1)
  │
  ▼
Express framework
  │
  ▼
Route handler executes
  │
  ▼
Response generated
  │
  ▼
Reverse path: Container → veth → Bridge → Host → Browser
```

### Why Port Publishing Exists

This journey makes the engineering purpose of `-p 5000:5000` unambiguous. The container's port 5000 exists in an isolated namespace. The host's port 5000 is a separate entry in the host namespace port table. Without an explicit forwarding rule, a packet arriving at the host on port 5000 finds no registered listener and is dropped.

`docker run -p 5000:5000` instructs Docker Engine to install an iptables rule in the host namespace that redirects packets arriving at host port 5000 to the container's port 5000 via the bridge. The rule bridges two otherwise isolated namespaces at a specific port.

Without this rule, the container is unreachable from the host regardless of what the application inside is listening on.

---

## Container-to-Container Communication

### Engineering Problem

The backend API must connect to the MySQL database. Both run as separate containers. The backend process cannot use `localhost:3306` because `localhost` inside the backend container refers to the backend container's own network namespace — MySQL is in a different namespace entirely.

### Investigation — Why localhost Fails

```
Backend Container Namespace          MySQL Container Namespace
─────────────────────────────        ──────────────────────────
localhost → 127.0.0.1                localhost → 127.0.0.1
Port table:                          Port table:
  5000 → Node.js                       3306 → mysqld

curl localhost:3306 from backend
  → queries backend namespace port table
  → port 3306 not registered
  → connection refused
```

The commands are identical. The namespaces are different. MySQL's port 3306 is registered only in MySQL's own namespace port table. The backend's namespace has no knowledge of it.

Hardcoded IP addresses would technically work — the backend could connect to `172.18.0.4:3306` — but this approach is brittle. Docker assigns IPs dynamically on each `docker compose up`. An IP assigned to MySQL in one run may be assigned to a different container in the next.

### Docker DNS — Service Discovery

Docker provides a built-in DNS server on user-defined bridge networks. When Docker Compose starts services, each service name is registered in Docker's internal DNS as a hostname resolving to that container's current IP address.

```
Docker DNS (internal)
─────────────────────
backend   →  172.18.0.2
frontend  →  172.18.0.3
mysql     →  172.18.0.4
```

The backend container can connect to `mysql:3306`. Docker DNS intercepts the hostname resolution, translates `mysql` to the current IP of the MySQL container, and returns it to the caller. The backend establishes a connection to the correct address without any hardcoded IP.

```
Backend: connect("mysql", 3306)
  │
  ▼
Docker DNS resolver
  │  "mysql" → 172.18.0.4
  ▼
TCP connection to 172.18.0.4:3306
  │
  ▼
Docker Bridge forwards to MySQL container
  │
  ▼
MySQL container namespace
  │  port 3306 → mysqld
  ▼
MySQL accepts connection
```

This is the mechanism behind the connection string `DB_HOST=mysql` in the application's environment configuration when running under Docker Compose. The value `mysql` is not a special Docker keyword — it is the service name, which Docker DNS resolves to the correct container IP at runtime.

---

## Docker Compose Networking

### Engineering Problem

Managing bridge networks, DNS entries, IP allocation, and veth pairs manually for every multi-container application would require significant operational effort. The commands would need to be executed in the correct order, repeated on every deployment, and tracked across environments.

### How Docker Compose Addresses This

When `docker compose up` executes, Compose reads the service definitions and automatically provisions the complete networking infrastructure:

- Creates one user-defined bridge network for the application
- Creates veth pairs for each container
- Connects each container to the bridge
- Allocates IP addresses from the bridge subnet
- Registers each service name in Docker's internal DNS

All of this happens before any container starts. By the time the application containers are running, the network is fully configured and service discovery is operational.

```yaml
services:
  backend:
    build: ./api
  frontend:
    build: ./client
  mysql:
    image: mysql:8
```

From this definition, Compose creates:

```
bridge network: project_default

DNS:
  backend  →  assigned IP
  frontend →  assigned IP
  mysql    →  assigned IP

backend  can reach  mysql:3306
frontend can reach  backend:5000
```

Every service name becomes a resolvable hostname. No IP addresses are managed manually. No DNS configuration is written. The networking that required explicit kernel configuration to understand is abstracted to service names in a YAML file — but the underlying mechanism is now fully understood.

---

## EXPOSE — Revised Understanding

### Engineering Problem

`EXPOSE 5000` was introduced earlier in this document as metadata declaring the application's intended port. Having completed the networking investigation, the understanding of what `EXPOSE` does — and critically, what it does not do — can be stated precisely.

### What EXPOSE Does Not Do

`EXPOSE` does not call `bind()`. It does not call `listen()`. It does not install any iptables rules. It does not register any entry in the host port table. It does not make the application reachable from outside the container.

The process that makes port 5000 accessible is:

```
app.listen(5000)
  │
  ▼
Node.js → socket() → bind() → listen()
  │
  ▼
Container namespace port table: 5000 → Node.js
```

This sequence executes entirely at runtime, driven by the application code. Docker has no involvement.

### What EXPOSE Actually Does

`EXPOSE` records intended port information as image metadata. It communicates to engineers reading the Dockerfile — and to orchestration tools such as Kubernetes — which port the application inside the image is expected to use.

A container runs correctly without `EXPOSE` if `-p` is specified at runtime:

```bash
docker run -p 8080:5000 api-image
```

This works regardless of whether the Dockerfile contains `EXPOSE 5000`. The port forwarding rule is established by `-p`. `EXPOSE` is documentation, not configuration.

---

## CMD — Revised Understanding

### Engineering Problem

`CMD ["node", "app.js"]` was established as the runtime startup instruction. Having completed the networking and PID 1 investigation, the relationship between `CMD`, PID 1, and container lifetime can be stated completely.

### Why Docker Permits Only One CMD

An image represents one main process. A container's lifecycle is defined by that process. Docker monitors PID 1. When PID 1 exits, the container's job is considered complete and the container stops.

```
docker run api-image
  │
  ▼
CMD executes: node app.js
  │
  ▼
Node.js becomes PID 1 inside container namespace
  │
  ▼
Docker Engine monitors PID 1
  │
  ├── PID 1 running  →  container status: running
  └── PID 1 exits    →  container status: exited
```

This explains the behavior of every container encountered in Phase 1:

- `hello-world`: PID 1 prints output and exits. Container exits immediately.
- `nginx`: PID 1 is the nginx master process — a web server designed to run indefinitely. Container runs until explicitly stopped.
- `node app.js`: PID 1 is the Node.js process. Container runs as long as the Express server is running. If the application crashes, PID 1 exits, the container stops, and Docker reports the exit.

The exec form `CMD ["node", "app.js"]` makes `node` PID 1 directly. The shell form `CMD node app.js` would make `/bin/sh` PID 1, with `node` as a child process. Shell form breaks signal delivery — SIGTERM sent to PID 1 reaches the shell, not Node.js, and graceful shutdown handling in the application is bypassed. Exec form is the correct choice for application startup.

---

## Networking Mental Model — Verification Questions

Before proceeding to the practical build and execution phase, the following five questions verify that the complete networking mental model is operational. Each question requires reasoning from the model, not recall of a fact.

**Why is a Docker bridge needed if every container already has a veth pair?**

A veth pair connects one container namespace to the host namespace. It provides connectivity between two points. For ten containers, ten veth pairs exist — but the veth pairs do not connect to each other. The bridge acts as the switching fabric that connects all container-side veth endpoints into one network. Without the bridge, containers on different veth pairs cannot communicate with each other. The bridge is the mechanism that turns isolated point-to-point cables into a shared network.

**Why does localhost fail when the backend tries to connect to MySQL in another container?**

`localhost` resolves to `127.0.0.1`, which is the loopback interface of the current network namespace. The backend container's loopback interface exists only within the backend namespace. MySQL is running in a separate namespace with its own loopback interface. There is no path from the backend's `127.0.0.1` to MySQL's namespace. The backend's port table has no entry for 3306. The connection is refused.

**Why can the backend use `mysql:3306` instead of an IP address?**

Docker's internal DNS server, active on user-defined bridge networks, registers each service name as a resolvable hostname. When the backend resolves the hostname `mysql`, Docker DNS returns the current IP address of the MySQL container on the bridge network. The backend connects to that IP. If the MySQL container is replaced and receives a new IP, DNS resolution returns the new IP automatically. No configuration change is required.

**Why does `EXPOSE 5000` not make the application reachable from the browser?**

`EXPOSE` is image metadata. It records which port the application intends to use. It performs no kernel operations — no `bind()`, no iptables rule, no host port registration. The application becomes reachable from the host only when a port publishing rule exists, either through `-p 5000:5000` at runtime or through a `ports` mapping in Docker Compose. That rule installs an iptables forwarding entry that redirects packets from the host port to the container port via the bridge. Without that rule, the container's namespace remains isolated from the host.

**Why does the entire container stop when `node app.js` exits?**

`node app.js` runs as PID 1 inside the container namespace. The Linux kernel's behavior when PID 1 exits is to send SIGTERM to all remaining processes in the namespace and tear down the process group. Docker monitors PID 1. When PID 1 exits — whether due to application crash, clean shutdown, or unhandled exception — Docker records the exit code and marks the container as exited. The container's network interfaces, filesystem, and process namespace all cease to be active. The container remains in the exited state (visible in `docker ps -a`) until explicitly removed.

---

## Build Context and the Docker Build Workflow

### Engineering Problem

Before executing a build, several questions require precise answers: where does Docker look for the Dockerfile, what is transmitted to Docker Engine, and what is the relationship between the project folder, the image, and the container? Imprecise answers to these questions produce incorrect mental models that surface as debugging failures in later phases.

### Investigation

**Where Docker locates the Dockerfile**

When `docker build -t backend:v1 .` is executed, the `.` argument defines the build context — the directory whose contents are packaged and transmitted to Docker Engine before any instruction executes. Docker Engine then reads the file named `Dockerfile` from within that build context.

The Dockerfile is not read by the CLI. It is read by Docker Engine after the build context is received:

```
Project Folder
      │
      ▼
Docker CLI
      │  packages build context
      │  sends to Docker Engine
      ▼
Docker Engine
      │  reads Dockerfile from build context
      │  executes instructions sequentially
      ▼
Image
```

An alternative Dockerfile path can be specified explicitly:

```bash
docker build -f Dockerfile.dev .
```

This is used when multiple Dockerfiles exist in a project — for example, separate development and production build definitions.

**The build context is not the Dockerfile**

The build context is the complete collection of files the CLI transmits to Docker Engine before any instruction executes. In this project, the `api/` directory constitutes the build context. Everything in that directory — except files excluded by `.dockerignore` — is packaged and sent. The build output confirmed this:

```
Sending build context to Docker daemon  5.224MB
```

Docker Engine may run on a remote machine and cannot read the local filesystem directly. The CLI transmits the build context to make files available to `COPY` instructions regardless of where the engine runs.

**The project lifecycle — a critical mental model**

The relationship between source code, image, and container is not a linear pipeline where the project folder becomes a container. It is a branching structure:

```
Source Code
      │
      ▼
docker build
      │
      ▼
Docker Image
(immutable — stored in local image store)
      │
      ├──────────────────────┐
      ▼                      ▼
docker run              docker run
      │                      │
      ▼                      ▼
Container 1            Container 2
```

Modifying source code after a build has no effect on the already-built image. A new build must be executed to incorporate changes. This distinction becomes critical in Kubernetes, where deployments reference image tags — not source directories.

---

## First Backend Image Build

### Execution

```bash
docker build -t backend:v1 .
```

### Build Output Analysis

**Build context transmission**

```
Sending build context to Docker daemon  5.224MB
```

The CLI packaged the `api/` directory and transmitted it to Docker Engine before any instruction executed.

**Step 1 — FROM node:22-alpine**

```
Step 1/7 : FROM node:22-alpine
22-alpine: Pulling from library/node
5e275a5205a0: Pulling fs layer
2b8c8ae4a685: Pulling fs layer
b05773cc67e1: Pulling fs layer
...
Status: Downloaded newer image for node:22-alpine
---> c610fcdfb1d5
```

Docker searched the local image store — not found. Docker contacted Docker Hub, downloaded the image, and stored it locally. The image arrived as multiple filesystem layers, each prefixed with `Pulling fs layer`. The Node image is itself a layered image built by the Node maintainers on top of Alpine Linux. The hash `c610fcdfb1d5` is the starting image ID for the new build.

**Step 2 — WORKDIR /app**

```
Step 2/7 : WORKDIR /app
---> Running in 8b41dab8b346
---> Removed intermediate container 8b41dab8b346
---> d90ce4a4e4e6
```

`Running in 8b41dab8b346` reveals Docker's internal build mechanism. No container was explicitly started. Docker created one automatically. This occurs because an image is immutable — Docker cannot modify it directly. For every instruction that changes the filesystem, Docker:

```
Current image state
      │
      ▼
Creates temporary container (writable)
      │
      ▼
Executes instruction inside temporary container
      │
      ▼
Captures filesystem changes as snapshot
      │
      ▼
Saves snapshot as new immutable layer
      │
      ▼
Deletes temporary container
      │
      ▼
New image state — input for next instruction
```

The temporary container `8b41dab8b346` was created, `/app` was created inside it, the filesystem was snapshotted, and the container was deleted. Only layer `d90ce4a4e4e6` persists.

**Step 3 — COPY package*.json ./**

```
Step 3/7 : COPY package*.json ./
---> 3eecae2d38ff
```

`package.json` and `package-lock.json` were copied from the build context into `/app`. Layer `3eecae2d38ff` created. No intermediate container output is shown for `COPY` — it does not require executing a shell command.

**Step 4 — RUN npm install --only=production**

```
Step 4/7 : RUN npm install --only=production
---> Running in 5aab8133be31
npm warn config only Use `--omit=dev` to omit dev dependencies from the install.
added 99 packages, and audited 100 packages in 2s
---> Removed intermediate container 5aab8133be31
---> 22afe435dc5c
```

Temporary container `5aab8133be31`. npm executed inside it, populating `node_modules` with 99 production packages. Container deleted. Layer `22afe435dc5c` — containing the installed `node_modules` — saved at 15.3 MB. This is the most expensive layer and the primary target of the cache optimisation strategy.

The npm warning `Use --omit=dev` indicates a newer npm API preference. Both `--only=production` and `--omit=dev` achieve identical results. Modern production Dockerfiles use `--omit=dev`. The functional difference is zero.

**Step 5 — COPY . .**

```
Step 5/7 : COPY . .
---> b5959015b55b
```

All remaining files from the build context — `app.js`, `controllers/`, `routes/`, `middleware/`, `models/` — copied into `/app`. Layer `b5959015b55b`: 8.11 MB. Positioned after `RUN npm install` so that source file changes invalidate only this layer and below, leaving the dependency installation layer cached.

**Steps 6 and 7 — EXPOSE and CMD**

```
Step 6/7 : EXPOSE 5000
---> Running in 5a9117b15dfe
---> Removed intermediate container 5a9117b15dfe
---> 259b4586262f

Step 7/7 : CMD ["node","app.js"]
---> Running in 9bd2f6ee2049
---> Removed intermediate container 9bd2f6ee2049
---> 3f1bc0cd51ef
```

Both produce intermediate containers. Both produce 0B layers — no filesystem changes. They update the image's configuration metadata: exposed port and default startup command.

**Final output**

```
Successfully built 3f1bc0cd51ef
Successfully tagged backend:v1
```

`3f1bc0cd51ef` is the content-addressable image identifier. `backend:v1` is the human-readable tag. Both reference the same image. The tag is a mutable pointer; the hash is the immutable identity.

**Image size**

```
backend:v1   3f1bc0cd51ef   257MB   63MB
```

The final image is 257 MB. The Alpine base is ~9 MB. The Node.js runtime contributes ~156 MB. npm packages contribute 15.3 MB. Application source contributes 8.11 MB. The base image is one layer in a stack — the final image includes all layers from all ancestors.

---

## Immutability and the Temporary Container Build Model

### Engineering Problem

Understanding why Docker creates and immediately deletes a temporary container for each instruction — rather than modifying the image directly — is the single insight that explains layers, caching, and image history simultaneously.

### Finding

An image is immutable. Docker cannot modify an existing image. To produce a new image state, Docker must:

1. Start from the current image state
2. Create a writable container on top of it
3. Execute one instruction inside that writable container
4. Capture the filesystem changes as a new read-only layer
5. Delete the writable container
6. Use the new image state as input for the next instruction

```
Image N (read-only)
      │
      ▼
Temporary container (writable layer on top of Image N)
      │
      ▼
Instruction executes — filesystem changes occur in writable layer
      │
      ▼
Writable layer snapshotted → new read-only layer
      │
      ▼
Image N+1 = Image N + new layer
      │
      ▼
Temporary container deleted
```

This model explains every observable behavior in the build output: why `Running in <hash>` appears, why `Removed intermediate container` follows immediately, why each instruction produces a distinct layer hash, and why the layer cache is possible at all.

---

## Layer Cache — Precise Engineering Model

### Engineering Problem

The layer cache was introduced conceptually in Phase 2A. After observing a real build and understanding the temporary container mechanism, the precise model can be stated.

### Finding

Docker does not ask whether an instruction has changed. Docker asks whether the **input** to that instruction has changed — the content of files being copied (for `COPY`) or the filesystem state at that point (for `RUN`), which is determined by all preceding layers.

The rule that governs all cache behavior:

> Once one layer's cache is invalidated, every subsequent layer must be rebuilt — regardless of whether those subsequent instructions changed.

Each layer is built on top of the previous one. If layer N changes, layer N+1 is built on a different parent. Even if the instruction for N+1 is identical, its parent has changed, so Docker cannot guarantee the result is identical.

**Applied to this Dockerfile when `controllers/user.js` changes:**

```
FROM node:22-alpine        → cache hit   (base image unchanged)
WORKDIR /app               → cache hit   (no input change)
COPY package*.json ./      → cache hit   (package files unchanged)
RUN npm install            → cache hit   (input layer unchanged)
COPY . .                   → cache MISS  (source file changed)
EXPOSE 5000                → rebuilt     (parent layer changed)
CMD ["node", "app.js"]     → rebuilt     (parent layer changed)
```

npm does not reinstall. The build completes in seconds. The cache optimisation from separating `COPY package*.json` from `COPY . .` is realised on every incremental source change.

Each layer is a checkpoint — a saved state that can be resumed from. If a source file changes, execution resumes from the source copy layer. Everything above it is served from cache.

---

## Image History Analysis

### Execution

```bash
docker history backend:v1
```

### Output

```
IMAGE          CREATED          CREATED BY                                      SIZE
3f1bc0cd51ef   53 minutes ago   /bin/sh -c #(nop)  CMD ["node" "app.js"]       0B
259b4586262f   53 minutes ago   /bin/sh -c #(nop)  EXPOSE 5000                 0B
b5959015b55b   53 minutes ago   /bin/sh -c #(nop) COPY dir:c98251f65c862bfb6…  8.11MB
22afe435dc5c   53 minutes ago   /bin/sh -c npm install --only=production        15.3MB
3eecae2d38ff   53 minutes ago   /bin/sh -c #(nop) COPY multi:b5e627c4a0c9d9e…  53.2kB
d90ce4a4e4e6   53 minutes ago   /bin/sh -c #(nop) WORKDIR /app                 8.19kB
c610fcdfb1d5   4 days ago       CMD ["node"]                                    0B
<missing>      4 days ago       ENTRYPOINT ["docker-entrypoint.sh"]             0B
<missing>      4 days ago       COPY docker-entrypoint.sh /usr/local/bin/       20.5kB
<missing>      4 days ago       RUN /bin/sh -c apk add --no-cache --virtual…   5.48MB
<missing>      4 days ago       ENV YARN_VERSION=1.22.22                        0B
<missing>      4 days ago       RUN /bin/sh -c addgroup -g 1000 node && …      156MB
<missing>      4 days ago       ENV NODE_VERSION=22.23.2                        0B
<missing>      6 weeks ago      CMD ["/bin/sh"]                                 0B
<missing>      6 weeks ago      ADD alpine-minirootfs-3.24.1-aarch64.tar.gz…   9.31MB
```

`docker history` outputs layers newest-first. Reading bottom-to-top follows the actual build sequence.

### Layer-by-Layer Analysis

**Layers inherited from the Node image — not written by this project**

The bottom nine layers belong to `node:22-alpine`. This project did not write them. They were inherited via `FROM node:22-alpine`.

| Layer | Size | What it represents |
|---|---|---|
| `ADD alpine-minirootfs-3.24.1-aarch64.tar.gz` | 9.31 MB | Alpine Linux base filesystem — the foundation of the entire chain |
| `CMD ["/bin/sh"]` | 0B | Alpine's default shell — metadata |
| `ENV NODE_VERSION=22.23.2` | 0B | Node version recorded as image metadata |
| `RUN addgroup -g 1000 node && ...` | 156 MB | Node.js runtime installation — the largest single layer |
| `ENV YARN_VERSION=1.22.22` | 0B | Yarn version metadata |
| `RUN apk add --no-cache ...` | 5.48 MB | Additional system packages via Alpine's package manager |
| `COPY docker-entrypoint.sh ...` | 20.5 kB | Node container entrypoint script |
| `ENTRYPOINT ["docker-entrypoint.sh"]` | 0B | Entrypoint metadata |
| `CMD ["node"]` | 0B | Default command metadata from Node image |

`FROM node:22-alpine` does not start from zero. The full ancestry is visible: Alpine Linux filesystem → Node runtime installed on Alpine → this project built on top of Node. Images inherit history. `FROM` means "continue building on top of another team's completed image."

**Layers from this project's Dockerfile**

| Layer | Size | Instruction |
|---|---|---|
| `WORKDIR /app` | 8.19 kB | `/app` directory created in image filesystem |
| `COPY package*.json` | 53.2 kB | `package.json` and `package-lock.json` |
| `npm install --only=production` | 15.3 MB | 99 production packages installed |
| `COPY . .` source files | 8.11 MB | Application source code |
| `EXPOSE 5000` | 0B | Port metadata |
| `CMD ["node", "app.js"]` | 0B | Startup command metadata |

**Why `#(nop)` appears**

Instructions that do not execute arbitrary shell commands are represented internally as `#(nop)` — no operation. This designation applies to `WORKDIR`, `COPY`, `EXPOSE`, `CMD`, `ENV`, and `ENTRYPOINT`. It indicates that the instruction modified image configuration or performed a filesystem operation through Docker's internal mechanisms rather than through a shell command execution.

**Why `<missing>` appears for parent layers**

`<missing>` does not indicate a corrupted or absent layer. It indicates that the parent image (`node:22-alpine`) was built using BuildKit on a different machine. The individual intermediate layer image IDs are not stored locally — only the final assembled image was pulled. The layers are present and functional; their individual identifiers are simply not tracked in the local image store.

**Size distribution**

```
Alpine base filesystem         9.31 MB
Node.js runtime              156.00 MB
Alpine packages                5.48 MB
Node entrypoint                0.02 MB
project node_modules          15.30 MB
project source code            8.11 MB
metadata layers (0B each)      0.00 MB
──────────────────────────────────────
Approximate total            ~194 MB
(reported as 257 MB including filesystem overhead)
```

The Node runtime alone constitutes the majority of the final image size. This is the engineering motivation for investigating Alpine versus Debian base images — a topic identified earlier and deferred for the next session.

### Filesystem Layers vs Configuration Layers — Refined Model

`docker history` confirms the distinction between two categories of build output:

**Filesystem layers** — produced by instructions that change the image filesystem: `FROM`, `RUN`, `COPY`, `ADD`, `WORKDIR`. These carry non-zero sizes and contain actual file content that becomes part of the container filesystem at runtime.

**Configuration metadata** — produced by instructions that update the image's execution specification: `CMD`, `EXPOSE`, `ENV`, `ENTRYPOINT`, `LABEL`, `USER`. These appear in `docker history` with 0B size. They do not add filesystem content. They are stored in the image's configuration JSON alongside references to the filesystem layers.

The simplified statement "every Dockerfile instruction creates a layer" is superseded by this more accurate model. `docker history` shows both categories. The 0B entries are not missing layers — they are configuration entries that carry no filesystem payload.

### Image Metadata Structure

A Docker image consists of two distinct components stored together:

```
Docker Image
├── Layer Stack (filesystem)
│   ├── Layer 0: Alpine base              9.31 MB
│   ├── Layer 1: Node runtime           156.00 MB
│   ├── ...
│   ├── Layer N-2: node_modules          15.30 MB
│   └── Layer N-1: application source    8.11 MB
│
└── Image Configuration (JSON)
    ├── Cmd:          ["node", "app.js"]
    ├── WorkingDir:   /app
    ├── ExposedPorts: {"5000/tcp": {}}
    ├── Env:          ["NODE_VERSION=22.23.2", ...]
    ├── Entrypoint:   ["docker-entrypoint.sh"]
    ├── Labels:       {...}
    └── Architecture: arm64
```

The configuration JSON records every `CMD`, `ENV`, `EXPOSE`, `WORKDIR`, and `ENTRYPOINT` instruction as structured data. When `docker run` creates a container, it reads this configuration to determine how to start the container process. `docker inspect backend:v1` exposes this configuration in full — the next diagnostic step before container execution.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Dockerfile instruction analysis — all instructions | Complete |
| `.dockerignore` investigation | Complete |
| Runtime vs development dependency engineering reasoning | Complete |
| Linux networking fundamentals — socket lifecycle | Complete |
| Linux port table and kernel packet routing | Complete |
| Why two processes cannot share one port | Complete |
| Network namespaces — structure and isolation model | Complete |
| Independent localhost per namespace | Complete |
| Independent port tables per namespace | Complete |
| Docker as Linux kernel configuration layer | Complete |
| Virtual Ethernet pair | Complete |
| Docker Bridge Network | Complete |
| Packet journey — browser to application | Complete |
| Container-to-container communication | Complete |
| Docker DNS and service discovery | Complete |
| Docker Compose networking model | Complete |
| EXPOSE — revised understanding | Complete |
| CMD — revised understanding and PID 1 lifecycle | Complete |
| Networking mental model verification | Complete |
| Build context and Docker build workflow | Complete |
| Build lifecycle — project folder vs image vs container | Complete |
| First backend image build — execution and output analysis | Complete |
| Immutability and the temporary container build model | Complete |
| Layer cache — precise engineering model | Complete |
| Image history analysis — `docker history backend:v1` | Complete |
| Filesystem layers vs configuration metadata — refined model | Complete |
| Image metadata structure | Complete |

### Remaining — Phase 2B Practical

| Topic | Status |
|---|---|
| Image metadata inspection — `docker inspect` | Pending |
| Backend container execution and verification | Pending |
| Port publishing verification | Pending |
| Intentional failure and debugging exercise | Pending |
| Engineering retrospective | Pending |
| Git commit | Pending |

### Open Investigation

The engineering decisions behind `FROM node:22-alpine` — specifically version selection strategy and the Alpine Linux engineering tradeoffs (musl libc vs glibc, image size, available system packages) — remain open and will be addressed during the container execution session.
