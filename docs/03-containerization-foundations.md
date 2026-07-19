# Phase 1 — Containerization Fundamentals

## Objective

Phase 1 establishes the foundational understanding of Docker as an engineering platform before any application-specific containerization work begins.

The goal was not to write Dockerfiles. The goal was to understand why Docker exists, how it is architected, what problems it solves, and how containers behave — building a mental model strong enough to make correct engineering decisions in every phase that follows.

Docker fundamentals must be understood before writing Dockerfiles for a specific reason: a Dockerfile is an implementation detail. Without understanding images, layers, the daemon, networking, and the container lifecycle, a Dockerfile becomes a collection of memorized lines with no engineering judgment behind them. When something breaks — and it will break — there is no foundation to reason from.

Engineering understanding is more important than memorizing Docker commands because commands change across versions, but the underlying architecture does not. An engineer who understands why port mapping exists will correctly configure it in Docker, Kubernetes, and any cloud platform. An engineer who only memorized `-p 8080:80` will be lost the moment the syntax changes or the context shifts.


---

## Engineering Problem

### The "Works on My Machine" Problem

Before containers existed, deploying software was an exercise in environment management. A developer writes an application on their laptop running Node.js 18, uses a specific set of npm packages, and relies on a particular operating system library. The application works perfectly in development.

When the same application is deployed to a staging server running Node.js 16, a different Linux distribution, and slightly different system libraries — it fails. The error message is cryptic. The root cause is an environmental inconsistency that has nothing to do with the application logic itself.

This is the "works on my machine" problem. It is not a developer error. It is an architectural gap between development environments and production environments.

### Dependency Conflicts

A single machine running multiple applications compounds the problem. Application A requires Python 3.8. Application B requires Python 3.11. Application C requires a specific version of OpenSSL that conflicts with what Application A expects. Installing all three on the same machine creates conflicts that are difficult to resolve and nearly impossible to maintain over time.

The traditional solution was to use separate machines for separate applications — expensive, wasteful, and operationally complex.

### Why Virtual Machines Were Not the Ideal Solution

Virtual machines solved the isolation problem but introduced a new one: overhead. Every VM runs a complete operating system — its own kernel, memory management, device drivers, and system processes. A machine running five VMs runs five complete operating systems simultaneously.

The result is:
- Slow startup times (minutes, not seconds)
- Heavy resource consumption per instance
- Large image sizes (gigabytes per VM)
- Significant operational overhead

VMs solve isolation but at a cost that makes them unsuitable for modern application deployment patterns where dozens or hundreds of services need to run, scale, and restart rapidly.

### Why Containers Exist

Containers solve the same isolation problem as VMs but at the process level rather than the machine level.

Instead of virtualizing hardware and running a full OS, containers share the host machine's kernel and isolate only the process, its filesystem, its network, and its resources. The result is:

- Startup in milliseconds
- Megabytes rather than gigabytes per instance
- Near-native performance
- Complete isolation between applications
- Identical behavior across every environment

A containerized application carries its own dependencies — the correct runtime version, the correct libraries, the correct configuration — packaged into an image. That image runs identically on a developer's laptop, a CI server, a staging environment, and a production cluster.

This is the core engineering value of containers: **reproducible, portable, isolated execution environments.**


---

## My Initial Hypotheses

These are the assumptions held before Phase 1 began. Documenting them is important — they represent the starting mental model, and understanding how each one evolved is as valuable as the final understanding itself.

**Docker is similar to a virtual machine.**
Initial assumption: Docker creates isolated virtual environments like VMware or VirtualBox. This was partially correct — isolation is a shared property — but fundamentally wrong about the mechanism. VMs virtualize hardware and run full operating systems. Containers share the host kernel and isolate only the process. The difference in architecture produces completely different performance, startup time, and resource consumption characteristics.

**Images and containers are almost the same thing.**
Initial assumption: an image and a container were effectively the same concept with different names. This dissolved quickly. An image is a static, immutable blueprint — a packaged filesystem with no running processes. A container is a live, running instance created from that blueprint. One image can produce dozens of simultaneous containers. Deleting a container does not affect the image.

**Docker simply "runs applications."**
Initial assumption: Docker is a tool that runs software. This undersells it significantly. Docker is a platform that packages applications with their complete runtime environment and executes them in isolated processes. The packaging is as important as the execution — it is what makes the runtime environment reproducible.

**Docker runs directly on macOS.**
Initial assumption: Docker on a Mac works the same way as Docker on Linux. This was incorrect. Docker Engine requires a Linux kernel. macOS does not have one. Docker Desktop (or Colima) runs a lightweight Linux virtual machine transparently. All containers actually run inside that Linux VM, not directly on macOS. This architecture has real consequences for networking and filesystem behavior that matter when debugging.

**Stopping and deleting a container are identical.**
Initial assumption: stopping a container removes it. These are completely different operations. Stopping a container halts the running process but preserves the container's filesystem state. It can be restarted. Deleting a container removes the container and its filesystem state permanently. The image it was created from is unaffected.

**Applications inside containers automatically become accessible from the browser.**
Initial assumption: if a web server runs inside a container, it is immediately reachable at `localhost` in the browser. This was wrong. A container runs inside an isolated network namespace. Its port 80 is only accessible within that namespace. To reach it from the host machine, an explicit port mapping must be defined: host port → container port. Without the mapping, the container is completely unreachable from outside.


---

## Investigation Questions

These are the engineering questions explored during Phase 1. Each question is documented alongside what the investigation revealed.

**Why does Docker exist?**
Explored in depth via the "works on my machine" problem. Revealed: Docker exists to eliminate environment inconsistency by packaging an application with its complete runtime environment into a portable, reproducible unit.

**Why not simply install software directly?**
Direct installation creates environment-specific state that cannot be reproduced reliably. It creates dependency conflicts between applications on the same machine. It produces no artifact that can be versioned, shared, or deployed. A Docker image solves all three.

**What problem do containers solve that virtual machines do not?**
VMs solve isolation but introduce excessive overhead. Containers solve isolation at the process level — sharing the host kernel, starting in milliseconds, consuming megabytes rather than gigabytes. Containers are the right tool for application-level isolation. VMs are the right tool for machine-level isolation.

**Image vs Container?**
An image is an immutable, layered filesystem snapshot — a blueprint. A container is a running process created from that image with its own writable layer. The relationship is analogous to a class and an instance in object-oriented programming.

**Docker CLI vs Docker Engine?**
The Docker CLI is a client that translates human commands into API calls. Docker Engine is the server that receives those API calls and executes them. They are separate components communicating over a socket. The CLI being separate from the engine is why remote Docker management is possible — the CLI can point at an engine running anywhere.

**What is Docker Hub?**
A public registry of container images. When `docker pull nginx` is executed, Docker contacts Docker Hub, finds the nginx image, and downloads it to the local image store. It is to Docker images what npm is to Node packages or PyPI is to Python packages.

**Why Docker Daemon?**
The daemon (`dockerd`) is the background process that manages the Docker engine. It listens for API requests, manages images and containers, handles networking, and manages volumes. Without the daemon running, no Docker command works — the CLI has nothing to talk to.

**Why Docker Context?**
Docker Context tells the CLI which Docker Engine to communicate with. The default context points to the local daemon. Additional contexts can point to remote engines or Kubernetes clusters. This is why `docker context ls` is a useful diagnostic command — it shows exactly where the CLI is sending its requests.

**Why Colima on macOS?**
Docker Engine requires a Linux kernel. macOS does not provide one. Colima is a lightweight tool that runs a Linux VM on macOS specifically to host Docker Engine. When Colima is running, it provides the Linux environment Docker needs. When Colima is stopped, Docker Engine is unreachable and all Docker commands fail.

**Why do containers stop?**
A container runs exactly as long as its PID 1 process runs. When PID 1 exits — for any reason — the container stops. This is not a bug. It is the designed behavior. A container is not a machine. It is a process.

**Why did hello-world exit?**
The hello-world image contains a single binary that prints a message and exits. PID 1 completed its work and terminated. The container had nothing left to do and stopped. This is correct behavior.

**Why did nginx stay running?**
The nginx image starts a web server as PID 1. A web server is designed to run indefinitely, listening for incoming connections. PID 1 never exits voluntarily, so the container continues running.

**Why does `docker ps` behave differently from `docker ps -a`?**
`docker ps` shows only currently running containers — those with an active PID 1. `docker ps -a` shows all containers regardless of state, including stopped and exited ones. A container that has exited is not gone — it still exists as a stopped instance until explicitly removed with `docker rm`.

**Why do containers need port mapping?**
Containers run in isolated network namespaces. A port inside a container (e.g., port 80) is only reachable within that namespace. The host machine has its own network namespace. Port mapping creates a forwarding rule: traffic arriving on host port X is forwarded to container port Y. Without this rule, the container's network is completely inaccessible from the host.

**Why are logs important?**
Containers have no interactive console by default. The only visibility into what a running container is doing is its log output — everything written to stdout and stderr. Logs are the primary debugging interface for containerized applications. Understanding HTTP status codes in logs (200, 304, 404) is fundamental to diagnosing application behavior.

**Why does `docker exec` exist?**
`docker exec` allows running an additional command inside an already-running container. It is the primary tool for inspecting the internal state of a container — examining the filesystem, checking environment variables, verifying installed packages. It is the container equivalent of SSH-ing into a machine.

**What is PID 1?**
PID 1 is the first process started inside a container. Every other process in the container is a child of PID 1. When PID 1 exits, the kernel sends SIGTERM to all remaining processes and the container stops. PID 1 is therefore the container's heartbeat — its continued execution is what keeps the container alive.

**Why are images reusable?**
An image is immutable. Running a container does not modify the image — it creates a new writable layer on top of the image for that container's runtime changes. The original image is always available to create new containers. One image can run simultaneously as hundreds of containers.

**Why does deleting a container not delete the image?**
A container is an instance created from an image. Deleting the instance has no effect on the template. The image exists independently in the local image store and can create new containers at any time. Images are deleted separately with `docker rmi`.


---

## Key Learnings

### Docker Architecture

Docker is a client-server system. These are not the same process and understanding the separation is fundamental to diagnosing problems.

```
┌─────────────────────────────────────────────────────┐
│                    HOST MACHINE                     │
│                                                     │
│  ┌─────────────┐        ┌────────────────────────┐  │
│  │  Docker CLI │──API──▶│     Docker Engine      │  │
│  │  (client)   │◀──────│     (dockerd daemon)   │  │
│  └─────────────┘        │                        │  │
│                         │  ┌──────────────────┐  │  │
│                         │  │  Image Store     │  │  │
│                         │  ├──────────────────┤  │  │
│                         │  │  Container Mgmt  │  │  │
│                         │  ├──────────────────┤  │  │
│                         │  │  Network Mgmt    │  │  │
│                         │  ├──────────────────┤  │  │
│                         │  │  Volume Mgmt     │  │  │
│                         │  └──────────────────┘  │  │
│                         └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Docker CLI** — the command-line interface. Translates commands like `docker run` into HTTP API calls sent to the Docker Engine. The CLI itself does nothing — it is a messenger.

**Docker Engine (dockerd)** — the daemon process that does all the actual work. It receives API calls, pulls images, creates containers, manages networks, and manages volumes. If the daemon is not running, no Docker operation is possible.

**Docker Context** — tells the CLI which engine to target. By default it points to the local daemon socket. This is why `docker context ls` is one of the first diagnostic commands to run when Docker behaves unexpectedly.

**Docker Hub** — the default public registry. When an image is not present in the local store, Docker Engine contacts Docker Hub to pull it. Private registries (AWS ECR, GitHub Container Registry) follow the same protocol.


---

### macOS Architecture — Why Colima Is Required

Docker Engine is not a macOS-native application. It requires a Linux kernel to run. macOS does not provide one. This is not a Docker limitation — it is an operating system reality.

```
┌──────────────────────────────────────────────┐
│                  macOS Host                  │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │              Colima                  │   │
│   │   (lightweight Linux VM manager)     │   │
│   │                                      │   │
│   │   ┌──────────────────────────────┐   │   │
│   │   │        Linux VM              │   │   │
│   │   │                              │   │   │
│   │   │   ┌──────────────────────┐   │   │   │
│   │   │   │    Docker Engine     │   │   │   │
│   │   │   │                      │   │   │   │
│   │   │   │  ┌───┐ ┌───┐ ┌───┐  │   │   │   │
│   │   │   │  │ C │ │ C │ │ C │  │   │   │   │
│   │   │   │  └───┘ └───┘ └───┘  │   │   │   │
│   │   │   │   Containers         │   │   │   │
│   │   │   └──────────────────────┘   │   │   │
│   │   └──────────────────────────────┘   │   │
│   └──────────────────────────────────────┘   │
│                                              │
│   Docker CLI ────────────────────────────▶   │
│   (communicates through Colima socket)        │
└──────────────────────────────────────────────┘
```

When `colima start` is executed, Colima launches a Linux VM and starts Docker Engine inside it. The Docker CLI on macOS is configured to communicate with that engine via a Unix socket. From the engineer's perspective, Docker appears to run natively. In reality, every container runs inside the Linux VM.

**Consequence:** If Colima is not running, Docker Engine is not running. The CLI has no daemon to connect to. Every Docker command fails with a connection error. This is not a Docker installation problem — it is a runtime state problem. The correct fix is `colima start`, not reinstalling Docker.


---

### Images

An image is an immutable, layered filesystem snapshot. It contains everything an application needs to run: the operating system base layer, runtime, dependencies, application code, and configuration. It does not contain a running process.

Key properties of images:

- **Immutable** — once built, an image cannot be modified. Running containers do not write back to the image.
- **Layered** — images are built in layers. Each instruction that creates a new layer is cached. If a layer has not changed, it is reused from cache during subsequent builds.
- **Reusable** — one image is the source for any number of containers running simultaneously. The image is never consumed or altered by container execution.
- **Stored locally** — pulled images are stored in the local image store managed by Docker Engine. `docker images` lists them. `docker rmi` removes them.
- **Versioned via tags** — `nginx:latest`, `nginx:1.25`, `node:20-alpine` are all distinct image versions identified by tags.

The relationship between an image and a container is analogous to a class and an instance in object-oriented programming. The image defines the structure. The container is the live instantiation.

---

### Containers

A container is a running instance of an image. When `docker run nginx` is executed, Docker Engine creates a new container from the nginx image, adds a writable layer on top of the image layers, and starts the defined process as PID 1.

**Container states:**

```
Image
  │
  ▼
Created ──▶ Running ──▶ Stopped/Exited
                              │
                              ▼
                           Removed
```

- **Running** — PID 1 is active. The container is executing.
- **Stopped / Exited** — PID 1 has terminated. The container's filesystem state is preserved but no process is running. The container can be restarted with `docker start`.
- **Removed** — the container has been deleted with `docker rm`. Its filesystem state is gone permanently. The image is unaffected.

**`docker ps` vs `docker ps -a`:**
`docker ps` shows running containers only. `docker ps -a` shows all containers in all states. An exited container is not removed — it occupies disk space and is visible in `docker ps -a` until explicitly removed.


---

### PID 1 — The Container's Heartbeat

Every container has exactly one process that serves as PID 1 — the first process started inside the container's process namespace. All other processes in the container are children of PID 1.

The Linux kernel has a fundamental behavior: when PID 1 exits, it sends SIGTERM to all remaining processes in the namespace and the container stops.

This explains the behavior of different images:

**hello-world:** The image contains a single binary. It executes, prints its output, and exits. PID 1 is done. The container stops immediately. `docker ps` shows nothing. `docker ps -a` shows the exited container.

**nginx:** The image starts the nginx master process as PID 1. nginx is a web server — it is designed to run indefinitely, accepting connections. PID 1 never exits voluntarily. The container stays running until explicitly stopped.

This means: when designing a containerized application, the process started as PID 1 must be a long-running foreground process. A script that starts a server and exits will produce a container that immediately stops.

---

### Docker Networking

Every container runs inside its own isolated network namespace. This means:

- The container has its own network interface
- The container has its own localhost (`127.0.0.1`)
- The container's localhost is not the host machine's localhost
- Multiple containers can all listen on port 80 internally without conflict — they are in separate namespaces

```
Host Machine
├── localhost:8080  ←── port mapping ───┐
│                                       │
└── Linux VM                            │
    └── Docker Engine                   │
        ├── Container A                 │
        │   └── localhost:80  ◀─────────┘
        ├── Container B
        │   └── localhost:80  (separate namespace — no conflict)
        └── Container C
            └── localhost:80  (separate namespace — no conflict)
```

Network isolation is a security and operational property. Containers cannot reach each other's ports by default. Explicit Docker networking configuration is required for inter-container communication.


---

### Port Mapping

Port mapping creates a forwarding rule between the host network and the container network. Without it, no traffic from outside the container's network namespace can reach a process running inside the container.

**Syntax:** `-p <host-port>:<container-port>`

**Example:** `-p 8080:80`

```
Browser
  │
  │  GET http://localhost:8080
  ▼
Host Machine (macOS)
  │  port 8080
  ▼
Colima Linux VM
  │
  ▼
Docker Engine
  │  forwards to container port 80
  ▼
Container
  │  nginx listening on port 80
  ▼
Response returned through the same path
```

The host port (8080) is what the outside world uses. The container port (80) is what the application inside listens on. These numbers are independent. The host port can be any available port on the host. The container port must match what the application actually listens on.

If no port mapping is defined, the container is completely unreachable from the host regardless of what port the application uses internally.

---

### Volumes

A container's writable layer is ephemeral — it exists only for the lifetime of that container. When the container is removed, all data written to its filesystem is gone.

This is the correct default for stateless applications: the container is disposable and reproducible. But for stateful data — database files, uploaded content, logs that must persist — the data must live outside the container in a volume.

Volumes are managed by Docker Engine and exist independently of any container. Mounting a volume into a container makes a directory on the host (or a Docker-managed location) available inside the container. Data written there persists after the container is removed and can be shared between containers.

The engineering principle: **containers should be stateless. State should live in volumes.**

This distinction becomes critical in Phase 2 when the MySQL database is containerized — its data files must be mounted via a volume or they are lost every time the container restarts.


---

### Docker Logs

A running container has no interactive terminal by default. The only window into what the container is doing is its log output — everything written by the application to stdout and stderr.

`docker logs <container-id>` retrieves that output.

When nginx was running with port mapping, browser requests generated log entries. These were examined to understand what HTTP status codes communicate:

| Code | Meaning | Observed When |
|---|---|---|
| `200` | OK — request succeeded | Browser successfully loaded the page |
| `304` | Not Modified — cached content served | Browser reloaded the page and used its cache |
| `404` | Not Found — resource does not exist | Requesting a path that nginx had no file for |

These codes are not Docker-specific. They are the HTTP protocol. Recognizing them in container logs is a fundamental debugging skill — they immediately communicate whether the problem is in the network path, the server, or the application logic.

Logs are one of the most important debugging tools in containerized environments because:
- The container has no shell session to inspect interactively while running
- Application behavior is only visible through what the application emits to stdout/stderr
- In Kubernetes, logs are the primary debugging interface for pods
- In CI/CD pipelines, logs are the only output available when a build or deployment fails

The practice of reading logs carefully — not skimming them — is a habit established in Phase 1 that applies to every subsequent phase.

---

### docker exec — Entering a Running Container

`docker exec -it <container-id> bash` opens an interactive shell inside a running container. This is the primary tool for inspecting a container's internal state without stopping it.

Inside the nginx container, the following was run:

```bash
cat /etc/os-release
```

Output confirmed: the container is running **Debian Linux**, not macOS. This is a direct observation of the host vs container filesystem separation.

The host machine is macOS. The container is Debian. They have completely different filesystems. Files on macOS are not visible inside the container. Files created inside the container are not visible on macOS (unless a volume is mounted). They are separate filesystem namespaces.

This observation is important because it clarifies a common confusion: when an application runs inside a container, it is running inside the container's operating system, not the host. A Node.js application containerized with a Debian base image will behave as if it is running on Debian, regardless of whether the host is macOS, Windows, or Linux.


---

### Colima Investigation — Debugging Methodology

At one point during Phase 1, Docker commands began failing with connection errors. Rather than searching randomly for a fix, a systematic diagnostic process was followed.

**Step 1 — Observe the symptom**
```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock
```

**Step 2 — Identify the components involved**
The error references a Unix socket. The Docker CLI connects to Docker Engine through this socket. If the socket is unreachable, either the socket path is wrong or the daemon is not running.

**Step 3 — Collect evidence**

```bash
docker version
# Error: Cannot connect to the Docker daemon

docker info
# Error: Cannot connect to the Docker daemon

docker context ls
# Shows current context pointing to colima socket

which docker
# /usr/local/bin/docker  — CLI is installed

which colima
# /usr/local/bin/colima  — Colima is installed

colima status
# colima is stopped
```

**Step 4 — Identify root cause**
The evidence was unambiguous. The Docker CLI was installed. Colima was installed. The context was pointing at Colima's socket. Colima was stopped. Therefore Docker Engine was not running. The socket did not exist. The connection failed.

**Step 5 — Apply the correct fix**
```bash
colima start
```

After Colima started and Docker Engine came online, all Docker commands worked immediately.

**The engineering lesson here is not about Colima.** It is about debugging methodology. The correct response to an unexpected failure is:
1. Observe the exact error message
2. Identify which components are involved
3. Collect evidence about the state of each component
4. Reason to the root cause from evidence
5. Apply one targeted fix
6. Verify the fix resolved the issue

Random searching for solutions without evidence collection is slower, less reliable, and produces no understanding. The same methodology applied here applies equally to Kubernetes pod failures, CI/CD pipeline errors, and AWS infrastructure issues.


---

## Engineering Decisions

**Understand architecture before commands.**
No Docker command was executed without first understanding what component it targets and what it does. The result is that every command has a known purpose and every output has an expected interpretation.

**Learn concepts before Dockerfiles.**
Writing a Dockerfile without understanding images, layers, and the build process produces a file that works by accident. Understanding the underlying model first means Dockerfile instructions are deliberate engineering choices, not copy-pasted lines.

**Always predict command behavior before execution.**
Before running any command, a prediction was made about what the output would be. When the output matched the prediction, the mental model was confirmed. When it did not match, that discrepancy became the most important learning in the session. This practice accelerates understanding faster than any other technique.

**Understand why before how.**
Port mapping syntax `-p 8080:80` is meaningless without understanding why it is needed. Understanding the network namespace isolation model first makes the syntax obvious and memorable. The same principle applies to every Docker concept.

**Use Docker as an engineering platform, not a command-line tool.**
Docker is understood as a system — daemon, CLI, registry, images, containers, networking, volumes — not as a list of commands. This produces an engineer who can reason about Docker behavior rather than one who can only reproduce memorized sequences.

**Debug systematically instead of searching for random solutions.**
Every unexpected behavior was diagnosed using the observe → evidence → root cause → fix methodology. This produced correct diagnoses on the first attempt in every case during Phase 1.

**Learn by experimentation.**
Concepts were verified by doing, not by reading. Stopping a container and then running `docker ps` to confirm it still appeared in `docker ps -a` — this kind of deliberate experiment builds understanding that no amount of reading produces.

**Build mental models instead of memorizing syntax.**
The mental model of a container as "a process running in an isolated namespace with its own filesystem and network" is more useful than memorizing any set of commands. The model generalizes. Commands are looked up. Understanding persists.


---

## Verification

Each of the following was verified deliberately — not assumed working.

| Verification | What It Proved |
|---|---|
| `docker version` returned client and server versions | Docker CLI installed and Docker Engine reachable |
| `docker info` returned engine details | Docker Engine operational with full context |
| `colima start` succeeded | Linux VM running, Docker Engine online |
| `docker run hello-world` printed message and exited | Image pulled from Docker Hub, container created, PID 1 executed and terminated correctly |
| `docker ps -a` showed hello-world as exited | Container preserved in stopped state after PID 1 exit |
| `docker run -d nginx` started container in background | Daemon mode confirmed, nginx running as persistent PID 1 |
| `docker ps` showed nginx running | Running container visible, exited containers not shown |
| `docker run -d -p 8080:80 nginx` | Port mapping rule created |
| Browser request to `localhost:8080` returned nginx page | Full path confirmed: browser → host port → Docker Engine → container port → nginx |
| `docker logs <container-id>` showed HTTP request entries | Log output captured, status codes 200/304/404 observed |
| `docker exec -it <container-id> bash` opened shell | Entry into running container confirmed |
| `cat /etc/os-release` inside container showed Debian | Host vs container filesystem separation confirmed |
| `docker stop <container-id>` then `docker ps` | Container no longer in running state |
| `docker ps -a` after stop | Stopped container still present — stop ≠ delete |
| `docker rm <container-id>` then `docker ps -a` | Container removed, image unaffected |
| `docker images` after container removal | Original nginx image still present in local store |
| `colima status` when Docker failing | Confirmed Colima stopped as root cause of connection error |


---

## Retrospective

### 1. What engineering problem was solved?

The fundamental problem solved in Phase 1 is environmental inconsistency — the inability to guarantee that an application behaves identically across different machines and environments. Docker solves this by packaging the application together with its complete runtime environment into an image. That image is the deployment unit. It behaves identically wherever Docker Engine runs.

A secondary problem solved is the conceptual gap between "Docker as a tool" and "Docker as an architecture." Phase 1 replaced the tool mental model with an architectural one: client, daemon, registry, image store, container runtime, network namespaces, and volume management are all distinct components with distinct responsibilities.

### 2. Which assumptions changed?

Every initial hypothesis documented at the start of Phase 1 changed:

- Docker is not a VM. It is a process isolation platform sharing the host kernel.
- An image and a container are fundamentally different. One is a static blueprint. The other is a live process.
- Docker does not "just run applications." It packages, isolates, and manages application execution environments.
- Docker does not run natively on macOS. It requires a Linux VM (Colima) to host Docker Engine.
- Stopping a container and deleting a container are completely different operations with different consequences.
- Applications in containers are not automatically accessible. Port mapping is an explicit, required networking configuration.

### 3. What discoveries fundamentally changed my understanding?

**PID 1** was the most fundamental discovery. Understanding that a container lives and dies with its PID 1 process reframes everything about how containers are designed. It explains why hello-world exits, why nginx persists, and why every Dockerfile must end with a foreground process. It is not configuration — it is the kernel behavior that defines container lifetime.

**Network namespaces** changed the understanding of isolation. The container has its own localhost. The host's localhost is a different network. This explains why port mapping is not a convenience feature — it is a necessary bridge between two isolated network namespaces.

**The Colima architecture** changed the understanding of Docker on macOS. Recognizing that all containers actually run inside a Linux VM managed by Colima explains every macOS-specific Docker behavior, including why `colima status` is a first-line diagnostic command.

### 4. How would I recognize these patterns in another technology?

The client-server architecture of Docker (CLI → Engine) appears in multiple technologies:

- **kubectl** (Kubernetes CLI) → **kube-apiserver** (Kubernetes control plane)
- **AWS CLI** → **AWS API endpoints**
- **Git CLI** → **GitHub remote server**

In every case, the CLI is stateless and the server holds the state. In every case, the CLI needs to know where the server is (Docker Context, kubeconfig, AWS region/endpoint, git remote). In every case, if the server is unreachable, every CLI command fails — and the correct diagnosis is to check the server, not reinstall the client.

The debugging methodology — observe → identify components → collect evidence → find root cause → apply fix — is technology-agnostic. It was applied to a stopped Colima instance in Phase 1. It applies equally to a crashed Kubernetes pod, a failed CI/CD pipeline, or an unreachable AWS endpoint.

### 5. Could I explain Phase 1 in an interview without opening the repository?

**Why Docker exists?** To solve environment inconsistency. An application packaged as a Docker image carries its complete runtime environment and behaves identically across development, staging, and production.

**Docker Architecture?** Client-server. The CLI translates commands into API calls. The daemon (dockerd) executes them. On macOS, Colima provides the Linux VM that hosts the daemon.

**Images?** Immutable, layered filesystem snapshots. The blueprint from which containers are created. Never modified by running containers.

**Containers?** Running instances of images. Live exactly as long as PID 1 runs. Isolated filesystem, network, and process namespace.

**Docker Engine?** The daemon process that manages everything — pulling images, creating containers, managing networks and volumes. Must be running for any Docker operation to work.

**Port Mapping?** A forwarding rule from a host port to a container port. Required because containers run in isolated network namespaces unreachable from the host without explicit mapping.

**Networking?** Each container has its own network namespace with its own localhost. Multiple containers can use the same internal port without conflict. Inter-container and host-to-container communication requires explicit configuration.

**Volumes?** Persistent storage mounted into containers. Required for any data that must survive container removal — databases, uploads, logs.

**Logs?** Everything a containerized application writes to stdout/stderr. The primary debugging interface. HTTP status codes in logs (200, 304, 404) are the first indicators of application behavior.

**docker exec?** Runs an additional command inside a running container. Used to inspect internal state, verify environment, examine the filesystem — without stopping the container.

**Colima?** A tool that runs a Linux VM on macOS to host Docker Engine. Required because Docker Engine needs a Linux kernel. When Colima is stopped, Docker Engine is offline and all Docker commands fail.


---

## Phase Summary

Phase 1 established the complete conceptual and architectural foundation for Docker. Every property of containers — isolation, ephemerality, PID 1 lifetime, network namespaces, port mapping, volume separation — was understood from first principles and verified through deliberate experimentation.

No Dockerfiles were written. No application was containerized. This was intentional. Phase 1 is the foundation. Attempting to containerize an application without this foundation produces a Dockerfile written by guesswork, debugged by frustration.

Phase 2 shifts the focus from running existing images to building new ones. The question changes from "how do containers work?" to "how does Docker build an image from application source code?" This means understanding Dockerfiles, the `docker build` process, image layers, build context, and the specific requirements of containerizing the Node.js API and React frontend that were investigated in Phase 0.

The baseline established in Phase 0 (a verified, working three-tier application) and the foundation established in Phase 1 (a complete understanding of Docker architecture and container behavior) together make Phase 2 a deliberate engineering exercise rather than a trial-and-error process.
