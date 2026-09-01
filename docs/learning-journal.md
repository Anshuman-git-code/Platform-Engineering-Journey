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

---

## Phase 2B — Backend Containerization

### On the Difference Between Images and Containers

Before Phase 2B, the distinction between image and container felt academic. After building, running, inspecting, breaking, and fixing the backend image, it became structural.

An image is a completed artifact. It is finished the moment `docker build` succeeds. Nothing about it changes after that point. A container is a live process that uses the image as its starting filesystem. The image is the recipe. The container is the meal. You can make the same meal a hundred times from the same recipe, and the recipe is unchanged by any of them.

The practical consequence: when a container misbehaves, the image is usually not the problem. The problem is the runtime configuration — environment variables, port mapping, network placement, or the application's own logic. Reaching for `docker build` to fix a runtime failure is the equivalent of rewriting a recipe because the oven temperature was wrong.

---

### On Immutable Layers as Engineering Infrastructure

The layer model initially felt like an implementation detail. Somewhere in Phase 2B it became clear it is an engineering principle.

Every instruction produces a snapshot. Snapshots are immutable. Identical content produces identical hashes. Docker stores one copy and references it by many names. This is not a Docker-specific idea. It is how Git works. It is how content-delivery networks work. It is how functional programming works. Immutability plus content-addressing produces a system where sharing is free, deduplication is automatic, and correctness is guaranteed by the hash.

The practical consequence: layer cache is not a performance trick. It is the natural result of building a system where every layer is identified by its content and stored exactly once. Reuse is not configured — it emerges from the design.

---

### On Build Time and Run Time as Separate Engineering Domains

The break/fix exercise made this concrete in a way no explanation could.

`CMD ["node", "server.js"]` built successfully. The image was produced. It was tagged. It passed every build-time check. Then it was run, and it failed immediately — file not found.

The build phase and the runtime phase are not a pipeline. They are two independent programs with different inputs, different outputs, and different failure modes. The build phase takes source code and produces an artifact. The runtime phase takes that artifact and produces a running process. A successful artifact does not imply a successful process. A compilation succeeding does not mean the program is correct. A build succeeding does not mean the container will start.

This distinction matters every time Kubernetes shows `CrashLoopBackOff`. The image built. The pod is failing. These are two different problems in two different layers.

---

### On Linux Namespaces as the Real Foundation

The most significant conceptual shift in Phase 2B was understanding that Docker does not own networking. Linux does.

Docker's port publishing installs iptables rules. Docker's network isolation creates network namespaces. Docker's container isolation creates process namespaces. Docker's filesystem layering uses overlay filesystems. Every one of these is a Linux kernel primitive. Docker is the orchestration layer that calls the kernel APIs that create and configure these structures, then manages their lifecycle.

This means that understanding a Docker networking problem requires understanding the Linux networking model: port tables, namespace isolation, the loopback interface being namespace-scoped, and iptables as the forwarding mechanism. The Docker abstraction is thin. When the abstraction leaks — as it does during debugging — the Linux model is directly visible.

---

### On localhost Not Meaning the Physical Machine

This took time to fully internalise.

`localhost` is not the machine. It is the loopback interface of the current network namespace. Every network namespace has its own loopback interface. A container's `localhost` and the host's `localhost` are completely separate interfaces, registered in completely separate port tables.

`curl localhost:5000` from the host and `curl localhost:5000` from inside a container are syntactically identical commands that query completely different port tables and may produce completely different results.

The consequence is immediate and practical: `DB_HOST=localhost` in a container's environment means "look for the database in this container's own namespace." If the database is in a different container, `localhost` will never find it. The correct value is the database service's name — resolved by Docker DNS to the container's IP on the shared network.

---

### On Docker Bridge and veth as Physical Infrastructure

Network namespaces explain isolation. They do not explain connectivity.

The veth pair is what makes isolated namespaces useful: one end in the host namespace, one end moved into the container namespace as `eth0`. A packet entering one end emerges from the other. The bridge aggregates all container-side veth endpoints into a single virtual switch, allowing containers to communicate without requiring direct connections between every pair.

What changed after understanding this: port publishing stopped being a Docker configuration option and became a physical infrastructure question. Without the iptables forwarding rule, there is no connection between the host's port table and the container's network namespace. The packet arrives at the host, finds nothing listening at that port, and is dropped. The container may be running perfectly. The connection simply does not exist. `-p` creates the rule. The infrastructure then exists. That is all that changes.

---

### On EXPOSE Being Documentation

`EXPOSE 5000` produces a 0B layer in `docker history`. It calls no kernel function. It opens no port. It creates no forwarding rule.

After running a container without port publishing and observing `ERR_CONNECTION_REFUSED`, and then running it with `-p 5000:5000` and observing a successful response, the role of `EXPOSE` became clear by its absence from that story. `EXPOSE` was present in the image the entire time. Its presence or absence changed nothing about reachability.

`EXPOSE` tells Docker and engineers what port the application intends to use. It is the application's declaration of its network interface. The actual networking — the iptables rule, the bridge, the veth — is created by `-p`. These are documented separately because they serve different purposes.

---

### On PID 1 as the Container's Contract

`ps` inside the running container showed:

```
PID   USER     TIME  COMMAND
    1 root      0:00 node app.js
   19 root      0:00 sh
   30 root      0:00 ps
```

PID 1 is the contract between the application and the container runtime. As long as PID 1 runs, the container runs. When PID 1 exits, the container exits. Docker does not decide when the container stops. The application does, by virtue of its PID 1 process either running or not.

This explains every container lifetime observation from Phase 1 onward: `hello-world` exiting immediately, `nginx` running indefinitely, the broken container exiting with code 1. They are all the same mechanism: the container's lifetime is the PID 1 process's lifetime.

---

### On Image Tags as Mutable Pointers to Immutable Content

`backend:broken` and `backend:v2` shared the same image ID because the Dockerfile was not saved before the rebuild. Docker compared the content of every layer. All were identical. Docker produced the same hash. It applied the new tag to the existing image.

This is not an edge case. This is the design. Tags are names. Image IDs are identities. A name can be moved. An identity cannot. `backend:latest` in a CI/CD pipeline is a tag that moves forward with every build. The images themselves never change — they accumulate in the registry, each identified by their immutable hash, with the `latest` tag pointing to whichever is current.

The Git analogy is exact: a branch name moves forward with each commit. The commits themselves are immutable. The branch is a mutable pointer to immutable content.

---

### On Docker as an Orchestrator of Linux Primitives

The mental model at the start of Phase 1 was approximately: Docker is software that runs containers. By the end of Phase 2B, the model is more precise: Docker is software that calls Linux kernel APIs — `clone()` with namespace flags, `mount()` for overlay filesystems, `iptables` for packet routing — and manages the lifecycle of the resulting structures.

The containers themselves are not Docker's invention. They are Linux process isolation, applied consistently and wrapped in a usable interface. Understanding this means that Docker problems that cannot be solved by reading Docker documentation can often be solved by reading Linux networking documentation. The two layers are separated by a thin abstraction that breaks predictably and in ways that are diagnosable when the underlying Linux model is understood.

---

## Phase 2B — Status

Phase 2B is complete. Every major topic — Dockerfile engineering, image construction, layer cache, networking fundamentals, container runtime, failure analysis, storage model — was investigated, verified experimentally, and documented.

The open investigation into `FROM node:22-alpine` Alpine tradeoffs carries forward to Phase 3, where multi-container deployment with Docker Compose will also resolve the MySQL connection failure observed throughout Phase 2B.

---

## Phase 3 — Frontend Containerization

### On the Fundamental Difference Between Frontend and Backend Containers

Phase 3 started with a question that seemed simple: can a browser execute React source code directly? Thinking through that question produced the most important conceptual shift in Phase 3.

The backend container runs a process. Node.js starts, opens a socket, waits for requests, and executes application logic on each one. The container is the runtime. The source code runs inside it.

The frontend container serves files. The React source code was already transformed — by a build tool, during the build phase — into ordinary HTML, CSS, and JavaScript. Those files are placed in a directory. Nginx reads them from disk and returns them when requested. No JavaScript executes inside the container. No framework runs. The container is a file server. The application runs in the browser after being downloaded.

This distinction changes everything about how the container is designed. The backend container needs a language runtime permanently. The frontend container needs a build tool once — to produce the output — and then never again.

---

### On Node.js as a Compiler

The framing of Node.js as a compiler for the frontend build was the most useful conceptual reframe in Phase 3.

When `npm run build` executes, Node.js is not serving a website. It is transforming source code into a different form. JSX becomes JavaScript function calls. CSS modules become scoped class names. Hundreds of import statements become a handful of optimised bundles. The transformation is complete when the build finishes. Node.js has nothing left to do.

This is identical to how a TypeScript compiler works: it reads `.ts` files, produces `.js` files, and exits. Nobody installs the TypeScript compiler in a production Docker image to run a TypeScript application. The compiled output is deployed. The compiler is left behind.

Seeing `npm run build` as compilation rather than execution made the multi-stage build design obvious rather than clever.

---

### On Multi-Stage Builds as Separation of Concerns

The multi-stage build felt like a Docker trick until the dependency analysis made it clear it is an architectural requirement.

The build environment and the runtime environment need completely different things. Combining them into one image produces an image that is wrong for both purposes: too heavy for production, and if the build tools were removed, unable to build.

The stage boundary is a hard separation. Nothing crosses it unless explicitly named in a `COPY --from` instruction. Everything else — hundreds of megabytes of `node_modules`, the entire source tree, the build tool itself — is permanently discarded at the `FROM nginx:alpine` line.

The analogy that made this concrete: a manufacturing plant that builds a product and a warehouse that stores and ships it. Nothing from the factory floor — the machinery, the raw materials, the in-progress inventory — goes into the warehouse. Only the finished product crosses the boundary. Multi-stage builds enforce the same separation in software.

---

### On npm ci as an Engineering Commitment

`npm ci` is not faster `npm install`. It is a different contract.

`npm install` says: install something compatible with these requirements.

`npm ci` says: install exactly what was tested.

The lockfile is the evidence that specific versions were tested. `npm ci` treats the lockfile as law. The production build installs what the developer tested, not what npm decides is acceptable on the day the Docker build runs.

This matters more in containerized environments than anywhere else. A container is expected to be reproducible — to behave the same whether built today or in six months. `npm install` breaks that expectation silently. `npm ci` enforces it explicitly, failing the build if the lockfile and manifest are inconsistent rather than resolving the inconsistency automatically.

---

### On Nginx and the Simplicity of Static File Serving

The intuition about Nginx being lightweight was correct, but Phase 3 made the reason precise.

Nginx serving static files performs three operations: receive request, find file, return file. There is no JavaScript to execute, no framework to initialise, no database to query. The request-to-response path is as short as it can possibly be.

Running Node.js for this task would be like using a full application server to serve a directory listing. The runtime overhead is real, the memory consumption is measurable, and none of it produces any benefit. Nginx is the right tool because it is purpose-built for exactly the operation being performed.

---

### On PID 1 as a Universal Container Principle

Phase 1 introduced PID 1. Phase 2B confirmed it with Node.js. Phase 3 reinforced it with Nginx.

Every containerized process that must run indefinitely — whether it is Node.js serving an API, Nginx serving files, or any other long-running service — must be configured to remain as PID 1 in the foreground. The mechanism varies: Node.js naturally stays in the foreground unless explicitly killed; Nginx requires `daemon off;` to prevent its default daemonizing behavior. The requirement is the same.

This is not a Docker-specific concept. It is a consequence of how Linux process management works. Docker monitors PID 1. When PID 1 exits, the container stops. Every containerized service must be configured accordingly.

---

## Phase 3 — Status

Phase 3 Dockerfile analysis is complete. The conceptual foundation — frontend execution model, build vs runtime distinction, multi-stage builds, `npm ci`, Nginx document root, `daemon off` — is fully established. The practical build, inspection, and verification work continues in the next session.

---

## Phase 3 — Practical Validation Observations

### On the Build Context Size

The frontend build context was 337.3MB — sixty times larger than the backend's 5.224MB. The cause was the local `node_modules/` directory being included in the build context before transmission to Docker Engine. This is a direct, measurable consequence of a missing or incomplete `.dockerignore`.

The irony is precise: `npm ci` inside the container performs a clean install and never touches the transmitted `node_modules/`. The 337MB was transmitted, never used, and then discarded. Adding `node_modules/` to `.dockerignore` would reduce the build context to a few megabytes and save significant transmission time on every build.

This observation demonstrates that `.dockerignore` is not only a security control — it is also a build performance control.

---

### On 1350 Packages Leaving Zero Trace in the Final Image

The single most visually striking observation from Phase 3 was the image size after the build:

```
frontend:v1   94.4MB
nginx:alpine  92.8MB
```

1350 packages were downloaded and installed. `npm run build` executed a full compilation and bundling pipeline. Stage 1 accumulated hundreds of megabytes of build tooling. The final image is 1.6MB larger than bare Nginx.

None of Stage 1's accumulation crossed the stage boundary. The `COPY --from=builder` instruction transferred approximately 90kB of JavaScript and CSS. Everything else — the Node runtime, 1350 packages, React source, build configuration — was permanently discarded at the `FROM nginx:alpine` instruction.

The stage boundary is a hard reset. It does not inherit, accumulate, or leak. Multi-stage builds are not a size optimisation applied after the fact — they are the architectural reason the final image is small.

---

### On pwd Returning / as Proof of Stage Isolation

When `docker exec` opened a shell inside the frontend container and `pwd` returned `/` — not `/app` — it was the most concrete possible proof of stage isolation.

`WORKDIR /app` was set in Stage 1. Stage 2 started from `nginx:alpine` with no inherited configuration. The working directory of the running container is whatever the base image of Stage 2 defines, plus whatever Stage 2 itself configures. Stage 1's `WORKDIR` instruction has no existence in Stage 2.

This single observation — a directory path — confirms the entire multi-stage isolation model more directly than any diagram.

---

### On Nginx's Master-Worker Architecture

`ps` inside the frontend container showed three processes: PID 1 (master), and two workers. The backend showed PID 1 (node) with no workers.

Node.js uses an event loop — a single-threaded, asynchronous model where one process handles many concurrent connections. Nginx uses a master-worker model — the master manages configuration and worker lifecycle, and workers handle connections in parallel across CPU cores.

Both are valid concurrency models for different purposes. The observation that mattered was the same in both cases: PID 1 is the process Docker monitors. Whether PID 1 is a Node.js event loop or an Nginx master process, the container runs as long as PID 1 runs.

---

### On Content Hashes in Filenames

`main.fe8d536d.js` — the eight-character hash embedded in the filename is generated from the file's content. If the JavaScript changes, the hash changes, and the filename changes. Browsers that cached the old file will request a new URL automatically on the next page load.

This is a deployment concern that the build tool handles automatically. The implication for containerization: every production build produces a uniquely named set of assets. Deploying a new container version does not require any cache invalidation mechanism — the new filenames do the work.

---

## Phase 3 — Status

Phase 3 is complete. The frontend image is built, the container is verified, and the complete delivery chain from React source to browser has been traced end-to-end.

Phase 4 begins the transition from individual containers to multi-container orchestration. Docker Compose will connect the frontend, backend, and MySQL into a single coordinated application — resolving the MySQL connection failure that has been present since Phase 2B.

---

## Phase 4 — Docker Compose

### On the Shift from Containers to Systems

Phases 1 through 3 developed a precise mental model for a single container: how it is built, how it runs, how its network namespace is isolated, how PID 1 governs its lifetime. Phase 4 required a different kind of thinking — not about any one container, but about how a set of containers constitutes an application.

The shift is from "how does this container work" to "how does this system behave." The individual container knowledge is still required. But the unit of reasoning becomes the service graph, not the individual image.

---

### On Declarative Infrastructure as a Mental Model

The five pre-Compose questions established something important before a single line of YAML was read: the problem Docker Compose solves is not primarily technical. It is an engineering consistency problem. Different developers creating infrastructure with different commands on different days produces different environments. The same code runs differently because the infrastructure differs.

Describing infrastructure declaratively — as a specification of what should exist rather than a sequence of steps to create it — is the pattern that eliminates this class of problem. The file is the contract. Everyone who executes it gets the same result.

Recognizing this as a pattern — not a Docker Compose feature — meant immediately understanding why Kubernetes manifests, Terraform, and CloudFormation exist. They solve the same problem at different scales. The mental model transfers.

---

### On Service Names vs Container Names

The distinction between service names and container names was the first genuinely new concept in Phase 4.

A service name is the application's internal address for a component. `DB_HOST=mysql` works because Docker DNS resolves `mysql` — the service name — to the MySQL container's current IP. It does not resolve the container name. It does not resolve the image name.

A container name is a CLI handle. `docker logs mysql` works because `container_name: mysql` was set. If the container name were `database123` but the service name remained `mysql`, `DB_HOST=mysql` would still work — because DNS resolves service names — and `docker logs database123` would be the command to use.

The practical consequence: in a horizontally scaled service where three backend containers run simultaneously, Docker Compose generates unique container names for each (`backend-api-1`, `backend-api-2`, `backend-api-3`). The frontend still connects to `backend:5000` — the service name, which DNS resolves to any available backend container. Service names are stable. Container names are not.

This is the same model Kubernetes uses: a Service provides a stable DNS name for a group of Pods. The Pods are replaceable. The Service is stable.

---

### On depends_on and the Container Started / Application Ready Distinction

`depends_on` was the most conceptually refined topic in Phase 4.

The initial intuition — that `depends_on: mysql` means "wait for MySQL to be ready" — is wrong in a specific and important way. It means "wait for the MySQL container to be started." The container starting and MySQL being ready are two different events separated by seconds of initialization.

Understanding why Compose chose not to solve the readiness problem by default was the more interesting question. Docker manages containers. It does not manage applications. Every application has a different definition of "ready." MySQL is ready when port 3306 accepts connections. A machine learning inference service is ready after loading a model that may take minutes to deserialize. Docker cannot know these things without the application or image author defining them explicitly.

The correct model: Docker is responsible for lifecycle — creating, starting, stopping containers. Applications are responsible for resilience — retrying connections, handling initialization delays, reporting health. These responsibilities do not overlap. Each belongs where it belongs.

---

### On Environment Variables as the Boundary Between Code and Configuration

Environment variables in Docker Compose are not a Docker feature. They are a Linux feature. Docker injects them into the process environment before the application starts. The application reads them via `process.env` in Node.js, `os.environ` in Python, `System.getenv()` in Java — the same mechanism used when running directly on a server without Docker.

What Docker Compose contributes is making it convenient to specify these values per service, per environment, in a single file. The injected values change the application's behavior without changing its code.

The different naming conventions between services — `MYSQL_ROOT_PASSWORD` vs `DB_PASSWORD` — made the underlying model clear. Docker does not define variable names. Each application defines its own configuration contract. Docker delivers whatever values are specified without interpreting or transforming them. The DevOps engineer's role is to translate between the contracts: ensure that the value MySQL expects under `MYSQL_ROOT_PASSWORD` is the same value the backend expects under `DB_PASSWORD`.

---

### On Volumes as the Boundary Between Ephemeral and Persistent

Every container phase before Phase 4 worked with stateless containers — the backend API and the Nginx file server. Removing and recreating them loses no meaningful state. That property is desirable and intentional.

MySQL is different. The database stores the application's persistent state. If `docker compose down` deleted the database, every restart would begin with an empty system. Volumes are the mechanism that separates "data that should outlive the container" from "data that is part of the container itself."

The named volume `mysql-data` exists independently of the MySQL container. It was created by Compose, it stores MySQL's data files, and it will exist after the container is removed. The next MySQL container that mounts it will find the data where it was left. Container and data have independent lifecycles. That independence is the engineering value of volumes.

---

## Phase 4 — Status

Phase 4 conceptual analysis is complete. The `docker-compose.yml` has been fully analyzed: services, image vs build, container names, restart policies, environment variables, volumes, ports, depends_on, and implicit networking. The practical phase — `docker compose up`, system verification, debugging, and retrospective — continues in the next session.

---

## Phase 4 — Compose Practical and Retrospective

### On Tracing Environment Variables Back to Application Code

Documenting the Compose file line by line against the actual source code made something concrete that had previously been abstract: every environment variable in the Compose file has a precise destination in the application.

`DB_HOST: mysql` → `process.env.DB_HOST` → `mysql.createConnection({ host: ... })` in `api/models/db.js`.

`JWT_SECRET: devopsShackSuperSecretKey` → `process.env.JWT_SECRET` → `jwt.sign(..., SECRET, ...)` in `api/controllers/authController.js`.

`RESET_ADMIN_PASS: 'true'` → `process.env.RESET_ADMIN_PASS === 'true'` → the admin password reset branch in `api/app.js`.

These are not Docker features. Docker delivers the values. The application was written to read from `process.env`. The Compose file provides the values. Three separate engineering concerns — infrastructure, application code, and configuration — each do their part without crossing into each other's domain.

---

### On the Browser Being Outside the Container Network

The frontend connect issue clarified the networking model precisely.

The React application is built with `REACT_APP_API=http://localhost:5000` baked into the JavaScript bundle. The browser downloads that bundle and executes it on the user's machine. The user's machine is not inside the Docker bridge network. When the browser calls `http://localhost:5000`, it is making a request to the host machine's port 5000 — which Docker forwards into the backend container.

This means: for browser-initiated API requests to work in a Compose setup, the backend port must be published to the host (`5000:5000`). The internal Compose network is irrelevant for browser traffic. The browser is a client outside the network.

This would change in a Kubernetes deployment with an ingress controller — or in a Compose setup with Nginx acting as a reverse proxy, where all traffic enters through a single host port and Nginx routes internally. For this project's development setup, the separate port mappings are the correct approach.

---

### On mysql-init as Infrastructure as Code at a Smaller Scale

The bind mount `./mysql-init:/docker-entrypoint-initdb.d` is a small but precise example of infrastructure as code at the data layer.

The database schema — the `users` table definition — exists as a SQL file in the repository. When the MySQL container starts for the first time, it executes that file automatically. A new developer who clones the repository and runs `docker compose up` gets a fully initialized database with the correct schema. They do not read documentation about which tables to create. The infrastructure creates itself from the code.

This is the same principle as Compose itself, applied one level deeper. The SQL file is version-controlled. Schema changes are tracked. The initialization is reproducible.

---

### On Phase 4 Completing the Docker Mental Model

Looking back across the phases:

Phase 1 established that Docker is an orchestration layer over Linux kernel primitives — namespaces, iptables, overlay filesystems. A container is a process in an isolated namespace, not a virtual machine.

Phase 2B established that a Dockerfile is a reproducibility specification for an execution environment. Every instruction is an engineering decision with a reason.

Phase 3 established that not all containerization problems are the same. A compiler and a server have different relationships to the code they process. Multi-stage builds are the architectural consequence of that difference.

Phase 4 established that services are stable logical identities for replaceable container instances. A system is described declaratively. Configuration is injected at deployment time. Data that must outlive containers lives in volumes.

The complete mental model: source code → image → container → service → system. Each layer has its own concerns, its own tools, and its own failure modes. Understanding each layer independently is what enables debugging across layers when they interact.

---

## Docker Track — Status: Complete

All Docker phases are complete. The engineering foundation is established for Kubernetes, where the same concepts — images, containers, services, networking, volumes, declarative descriptions — are extended to multi-node cluster management at production scale.

---

## Phase 5 — Kubernetes Foundations

### On Why Kubernetes Feels Inevitable Once the Problem Is Clear

The most effective framing for Kubernetes was not "here is what Kubernetes does" but "here is what fails at scale without Kubernetes."

Once the four problems — Scheduling, Self-Healing, Scaling, Service Discovery — were stated explicitly, every Kubernetes component stopped feeling like arbitrary complexity. The API Server exists because you need one authoritative entry point to prevent split-brain. etcd exists because the API Server needs to be stateless and restartable. The Scheduler exists because placement decisions require global cluster visibility. The kubelet exists because execution must be local to each machine. Pods exist because co-located containers need a shared execution context.

None of these are inventions. They are solutions to engineering problems that become unavoidable at scale.

---

### On the Desired State Model as a Universal Pattern

The Desired State / Actual State reconciliation loop is not a Kubernetes idea. It appears in:

- Kubernetes: desired Pod count vs running Pod count
- Terraform: desired infrastructure state vs actual AWS state  
- Docker Compose: declarative service descriptions
- React: desired UI state vs rendered DOM

The pattern is: describe what should exist, observe what does exist, compute the difference, apply changes. Understanding it in Kubernetes means recognizing it everywhere.

---

### On the API Server / etcd Split Mirroring the Backend / MySQL Split

The observation that the API Server is stateless and delegates persistence to etcd — and that this mirrors Express being stateless and delegating persistence to MySQL — made the architecture immediately comprehensible.

Express doesn't "remember" user data between restarts. It reads MySQL on every request. The API Server doesn't "remember" cluster state between restarts. It reads etcd on every request. Both are purpose-built to process requests quickly without holding state themselves. Both delegate the persistence concern to a specialized component.

The pattern: stateless request processor + stateful storage backend. It appears at the application layer and at the infrastructure layer.

---

### On kubelet as the Local Agent Pattern

The kubelet is not unique to Kubernetes. Every large distributed system needs local agents on managed machines that receive instructions from a central system, execute them locally, and report status back.

AWS Systems Manager Agent does this for EC2 instances. Puppet/Chef agents do this for configuration management. Prometheus Node Exporter does this for metrics collection.

The pattern: central decision-maker + local agents. The central system knows the global desired state. The local agents know the local actual state. The reconciliation happens at the agent level, locally, without requiring the central system to SSH into machines.

---

### On Pods and Why Kubernetes Didn't Just Reuse Docker's Container Model

Docker manages containers. Kubernetes could have managed containers. The decision to introduce the Pod abstraction instead was an architectural choice: if containers sometimes need to share a network namespace, a volume, and a lifecycle, then the unit that gets scheduled, networked, and managed should be the group — not the individual container.

The Pod is that group. In most deployments, a Pod contains one container. But the abstraction is correct for the general case, and the consistent interface it provides — one IP per Pod, one scheduled unit, one lifecycle — simplifies every other system that interacts with running workloads.

---

## Phase 5 — Status

Phase 5 cluster architecture is complete. The Control Plane components (API Server, etcd, Scheduler, Controller Manager), Worker Node components (kubelet, container runtime), the Desired State model, and the Pod abstraction have all been established from engineering first principles. The remaining Phase 5 topics — ReplicaSets, Deployments, Services, and cluster networking — continue in the next session.

---

## Phase 5 — Pods, ReplicaSets, Deployments, Services

### On Discovering Why Pods Exist Before Being Told

The Pod concept was introduced through the log-shipping scenario — two containers that must always run together, share localhost, and share a lifecycle. Working through that scenario before the definition arrived meant the definition was a confirmation of reasoning rather than a new fact to memorize.

The most important realization: Google did not invent Pods because containers were insufficient. They invented Pods because the unit of scheduling, networking, and lifecycle management needed to be a group, not an individual container. Everything else in Kubernetes — Deployments, Services, the Scheduler — operates on Pods. Making the Pod the atomic unit keeps every other system simple.

---

### On the Pause Container as Hidden Infrastructure

The Pause container was the biggest conceptual surprise in Phase 5. Every Pod runs a container that is invisible in normal operations, consumes negligible resources, and exists solely to hold a network namespace open. This is elegant engineering: instead of coupling two application containers' lifecycles to each other's network namespace, both containers join a third container's namespace — one that never crashes because its only instruction is to sleep.

The consequence: when the backend container crashes and restarts, the Pod's IP address does not change. The network namespace lives in the Pause container, not in the backend container. Other services continue routing to the same IP while the backend recovers.

This also explains how "shared localhost" works at the kernel level. Two containers sharing a network namespace is not a Kubernetes abstraction — it is a Linux kernel feature that Kubernetes exposes through the Pod spec.

---

### On the Reconciliation Loop as the Central Pattern

The reconciliation loop appears in every Kubernetes controller: observe actual state, compare to desired state, compute delta, act to close the gap. This is not just a Kubernetes design — it is a fundamental pattern in resilient distributed systems.

Event-driven systems are fragile: if the event that triggers a repair is lost, the repair never happens. Reconciliation-driven systems are resilient: the repair loop runs continuously regardless of whether any event was received. The cluster repairs itself not because something told it to, but because it continuously checks whether it should.

Recognizing this pattern makes every controller's behavior predictable. A ReplicaSet Controller reconciles Pod count. A Deployment Controller reconciles ReplicaSet configurations. A Node Controller reconciles node availability. The pattern is the same. Only the objects being reconciled differ.

---

### On Why Deployments Create New ReplicaSets

The decision to create a new ReplicaSet for each deployment version rather than modifying the existing one was the most important Deployment insight. It preserves version history as data — not as documentation, not as a git tag, but as live Kubernetes objects that can be immediately activated by scaling them up.

A rollback is not a redeployment. It is a scaling reversal. The old ReplicaSet already exists. Its Pod spec is already correct. Its image is already in the registry. Scaling it from 0 to 3 and the new ReplicaSet from 3 to 0 is a matter of seconds.

This design decision explains something that previously seemed like magic: rollbacks in Kubernetes are fast not because Kubernetes is fast, but because the previous version was never actually deleted.

---

### On Services and the Same DNS Pattern at Cluster Scale

Docker Compose service names resolve to container IPs via Docker's internal DNS. Kubernetes Service names resolve to stable ClusterIPs via kube-dns. The mechanism differs in implementation — kube-dns instead of Docker DNS, iptables rules instead of bridge forwarding — but the engineering model is identical.

The scale difference matters: in Docker Compose, one container per service. In Kubernetes, a Service fronts one or many Pod replicas and load balances across them. But the application code is the same: `DB_HOST=mysql` works in both environments because the DNS resolution model is consistent. Moving from Docker Compose to Kubernetes does not require changing the database hostname in the application — only deploying a Service named `mysql`.

---

## Phase 5 — Status: Complete

All Kubernetes foundational concepts are established. The complete execution path from `kubectl apply` through API Server, etcd, Controller Manager, Scheduler, kubelet, containerd, to a running Pod serving traffic through a Service is fully understood from first principles.

Phase 6 applies this understanding to the project's actual Kubernetes manifests in `K8s/`.

---

## Phase 5 — Cluster Networking, kube-proxy, End-to-End Flow

### On Cross-Node Networking Being the Same Primitives at Larger Scale

The cross-node packet journey was easier to understand than expected because every primitive was already familiar: namespaces, veth pairs, routing tables. The only new element was the physical network segment between Worker Nodes — and that is just normal IP routing that Linux has performed since the 1990s.

The CNI plugin insight changed how Kubernetes is perceived. Kubernetes does not own networking. It defines a contract — every Pod gets a unique cluster-wide IP and can reach every other Pod directly. The CNI plugin builds the actual network fabric that satisfies that contract. This is the same delegation model seen throughout Kubernetes: define the interface, delegate the implementation. Container runtime interface for containers. CNI for networking.

---

### On kube-proxy Being a Programmer, Not a Proxy

The name "kube-proxy" implies it sits in the middle of every packet. The reality is more elegant: kube-proxy is a configuration agent that programs Linux iptables rules and then steps out of the way.

This distinction has a concrete consequence. If kube-proxy crashes, existing Services continue working because the kernel rules still exist. New Services become unreachable from that node because no agent is present to add new rules. The failure boundary is precisely defined: control plane configuration is disrupted; data plane forwarding is unaffected.

The same pattern appeared with Docker: Docker Engine installs port forwarding rules. Linux executes them. Docker could crash after the rules are installed and existing containers would continue receiving traffic. The pattern is identical at every level.

---

### On the Abstraction Ladder as a History of Cloud Computing

Looking at the complete abstraction ladder — Linux Process → Container → Pod → ReplicaSet → Deployment → Service → kube-proxy → Linux kernel — it maps almost exactly to the chronology of cloud infrastructure engineering:

Linux gave processes. Docker gave containers. Kubernetes gave everything above that. Each layer was invented to solve a problem the layer below could not solve. Seeing the ladder as a historical progression rather than a static hierarchy makes it easier to understand why each abstraction exists and what specific failure mode it was designed to prevent.

---

### On High Availability Being About Transparency, Not Prevention

The most important insight from the end-to-end flow analysis: Kubernetes does not prevent failures. It makes failures invisible to the systems that depend on the failed component.

A backend Pod crashes. The ReplicaSet creates a replacement. kube-proxy updates the routing rules. The frontend, which only knows `backend-service`, continues sending requests without modification. The failure was real. The recovery was real. The frontend experienced neither.

This is the engineering definition of high availability at the Kubernetes level: not that nothing fails, but that failures are recovered automatically and the recovery is transparent to callers.

---

## Phase 5 — Status: Complete

Phase 5 Kubernetes Fundamentals is fully complete. The entire architecture from cluster creation through the complete request lifecycle has been established from engineering first principles. No black boxes remain.

The transition to Phase 6 means writing YAML — but every field in that YAML maps to a concept already fully understood.

---

## Phase 6 — Kubernetes Deployment

### On Deriving the Deployment Manifest Before Seeing YAML

The exercise of predicting Deployment manifest contents before opening a file produced a result that was architecturally sound even if the syntax was imprecise. The key insight was that a Deployment must contain a Pod template — not existing Pods. This distinction mirrors the Docker image/container relationship exactly: an image is a blueprint for containers; a Deployment template is a blueprint for Pods.

The prediction exercise also revealed a common misconception: placing all application services inside one Deployment. Each service (backend, frontend, MySQL) needs its own Deployment because their lifecycles are independent. A crashed backend Pod should not trigger a MySQL Pod restart.

---

### On Secrets and ConfigMaps as the Kubernetes Configuration Separation

The `valueFrom: secretKeyRef` and `valueFrom: configMapKeyRef` patterns solved a problem that existed even in Phase 0 — credentials embedded in `.env` files checked into repositories. The Kubernetes model cleanly separates:

- Application code (Deployment) — version controlled, no credentials
- Non-sensitive configuration (ConfigMap) — environment-specific values
- Sensitive configuration (Secret) — credentials, never in manifests

The consequence: the same Deployment YAML can be applied to development and production by changing only the Secret and ConfigMap objects in each namespace. The Deployment itself never changes. The image never changes. Only the injected values differ.

---

### On the Declarative Mental Model as a Permanent Shift

Writing `replicas: 3` in Docker Compose and writing `replicas: 3` in Kubernetes look identical but mean different things.

In Docker Compose on a single machine, `replicas: 3` starts 3 containers. If one dies, the restart policy handles it locally.

In Kubernetes, `replicas: 3` is a declaration that the desired state of the cluster permanently includes 3 backend Pods. The Controller Manager continuously reconciles reality against this declaration — on any node, after any failure, after any deployment. The declaration outlives any individual Pod, any individual Node, and any individual component failure.

The shift from "run this" to "this should always exist" is the most important conceptual change in moving from Docker to Kubernetes.

---

## Phase 6 — Status: In Progress

Backend Deployment manifest analyzed and written. Backend Service, MySQL stack (Secret, ConfigMap, PVC, Deployment, Service), and Frontend Deployment and Service continue in the next session.

---

## Phase 6 — Kubernetes Practical Deployment

### On Seeing the Control Plane as Pods

The most striking observation when `kubectl get pods -A` returned `kube-apiserver-minikube`,
`etcd-minikube`, `kube-scheduler-minikube`, and `kube-controller-manager-minikube` was that
these are not daemons managed by systemd. They are Pods. The same object type used for
application workloads is used for Kubernetes itself.

This means the Kubernetes architecture is recursive — Kubernetes manages itself using the same
primitives it provides to applications. It also means debugging the control plane uses the
same tools as debugging application Pods: `kubectl logs`, `kubectl describe`, `kubectl exec`.

---

### On ConfigMap as a File — A Different Usage Pattern

Until Phase 6, ConfigMaps were only used for environment variable injection. The MySQL
initialization requirement introduced the second usage pattern: mounting a ConfigMap key as a
physical file inside a container's filesystem.

The mental model that made this clear: Kubernetes is a delivery mechanism. `MYSQL_DATABASE`
is delivered as a string in the process environment. `init.sql` is delivered as bytes at a
filesystem path. Same object type, different delivery mechanism, completely different
application behavior.

The application (MySQL) never knows either value came from Kubernetes. It reads environment
variables through standard Linux `getenv()`. It reads files through standard Linux `open()`.
Kubernetes is invisible at the application layer.

---

### On the MySQL One-Time Initialization Trap

The most practically important debugging lesson in Phase 6: the MySQL Docker image's
initialization scripts run exactly once — when the data directory is empty. Every subsequent
start skips them to protect existing data.

This means the sequence matters precisely:
1. PVC must be empty (never initialized)
2. Deployment must include the `initdb` volume mount
3. MySQL starts for the first time with both conditions true

Applying the ConfigMap mount after MySQL had already initialized produced no visible error —
MySQL silently ignored the SQL file. The only way to force re-execution was to delete the PVC
(destroying all data) and start fresh. In production, this would be a database migration tool
(Flyway, Liquibase) or a Kubernetes Job — never a destructive PVC delete.

---

### On the Pending Pod as a Safety Mechanism

When the PVC was deleted and the Deployment was reapplied, the Pod stayed `Pending`
indefinitely with `FailedScheduling: persistentvolumeclaim "mysql-pvc" not found`.

The first instinct was to treat this as a failure. It is the opposite. The Scheduler is
refusing to place a Pod that cannot satisfy its declared dependencies. A Pod that started
without its required storage would write data to the ephemeral container layer — appearing
to work until the first restart destroys everything.

Kubernetes's refusal to schedule an incomplete Pod is not an error condition. It is a
correctness guarantee.

---

### On the Rolling Restart Log Observation

`kubectl rollout restart` creates a new Pod while keeping the old one alive. Running
`kubectl logs deployment/backend` during the transition returned logs from the terminating
old Pod — complete with the old error. This looked like the fix had not worked.

The lesson: `kubectl logs deployment/NAME` is non-deterministic when multiple versions of a
Pod are running during a rollout. The command returns logs from whichever Pod it selects.
The correct approach during a rollout is to specify the exact new Pod name, or wait for
the rollout to complete before checking logs.

---

### On the Entire Stack Coming Together

When `kubectl logs -n prod deployment/backend` finally showed:
```
🚀 Server running on http://0.0.0.0:5000
MySQL Connected
✅ Admin user created: admin@example.com / admin123
```

each line mapped to a specific Kubernetes component:

- `Server running` — kubelet started the container, containerd ran Node.js, Express bound port 5000
- `MySQL Connected` — CoreDNS resolved `mysql`, kube-proxy forwarded to the MySQL Pod, the Secret's
  password authenticated successfully
- `Admin user created` — the `users` table from `init.sql` exists, the INSERT succeeded, the PVC
  persisted the data

The entire stack — Namespace, ConfigMap, Secret, PVC, StorageClass, Deployment, ReplicaSet,
Service, DNS, kube-proxy — participated in producing those three log lines.

---

## Phase 6 — Status: In Progress

MySQL and backend are deployed and verified. Frontend deployment, self-healing investigation,
scaling exercise, and rolling update observation continue in the next session.

---

## Phase 7 — Frontend on Kubernetes and Ingress

### On Build-Time vs Runtime Environment Variables

The distinction between React's build-time environment variables and Kubernetes's runtime
injection was the most important conceptual gap in Phase 7. Every backend environment variable
in this project is read at container start via `process.env`. The same mental model applied
to the frontend produced a wrong deployment that appeared correct.

React's Webpack build inlines every `process.env.REACT_APP_*` reference as a literal string
during `npm run build`. The resulting JavaScript has no `process.env` calls — only string
constants. Kubernetes `env:` injections happen after the image is built. By the time the
container starts, the bundle is already compiled and static. Nginx serves it without executing
any Node.js.

This is the reason the `v2` image failed silently — the `env:` field in the Deployment had
no effect. The bundle still contained `http://localhost:5000` from the previous build.

---

### On Why Internal DNS Should Never Appear in Browser-Facing Code

`ERR_NAME_NOT_RESOLVED` for `http://backend:5000` was the moment Kubernetes networking became
fully concrete. The hostname `backend` resolves correctly from inside the cluster via CoreDNS.
It does not resolve on the Mac's DNS because it is not a real hostname — it only exists in
the private virtual network created by Kubernetes.

The correct pattern is that the browser communicates with a stable, external hostname
(`crud.local` in development, a real domain in production). The Ingress translates that
hostname into internal routing decisions. The browser never needs to know that `backend` or
`mysql` exist.

---

### On the Duplicate `/api` Prefix Bug

This was an easy bug to make and a clarifying bug to fix. `baseURL: '/api'` means every
request path is appended to `/api`. If a call site says `axios.post('/api/auth/register')`,
the resulting URL is `/api/api/auth/register`. The path structure only makes sense when you
see `baseURL` and the call site together — neither is wrong in isolation.

The fix was straightforward once the rule was clear: when `baseURL` ends with `/api`, call
sites must start with the resource path, not repeat the prefix.

---

### On the Stale Connection as a Kubernetes Lesson

The 500 error from a stale MySQL connection arrived at the best possible moment — after the
entire Kubernetes infrastructure was verified working. The debugging sequence ruled out every
infrastructure layer (networking, DNS, Service, ConfigMap, Secret, PVC) before concluding
that the problem was in application code.

The root cause — `mysql.createConnection()` creating one persistent TCP connection that dies
when the upstream Pod restarts — is a correct Kubernetes behavior observation. Kubernetes
ephemeral Pods restart. Applications must anticipate this. The fix (restart the backend to
establish a fresh connection) works but is not the production solution. A connection pool
(`mysql.createPool()`) handles dropped connections automatically, without operator intervention.

This is the practical difference between "it works" and "it is production-grade."

---

### On Rolling Updates Becoming Visible

By the end of Phase 7, `kubectl describe deployment frontend` showed three ReplicaSets —
one per image version deployed (v2, v3, v4). Each update created a new ReplicaSet rather than
modifying the existing one. The event log showed the exact sequence: scale up new, scale down
old, one Pod at a time.

Phase 5 described this mechanism abstractly. Phase 7 made it observable in a live cluster.
The same events that were drawn as boxes in diagrams appeared as timestamped entries in
`kubectl describe`. This is the value of building the complete stack rather than running
isolated examples.

---

## Phase 7 — Status: Complete

The complete three-tier application runs end-to-end on Kubernetes. Register, login, and
user management all function through the Ingress at `http://crud.local`. Phase 8 is CI/CD.

---

## Phase 8 — GitLab CI/CD Foundation

### On the Shell Executor Giving Direct Mac Access

The most practically interesting aspect of Phase 8A was watching the first GitLab pipeline
job execute and seeing `Docker version 29.6.0` and `kubectl version v1.33.2` in the job
output. The pipeline job was running on the Mac — the same machine where the Docker images
were built in Phase 2 and the Kubernetes cluster was deployed in Phase 6.

The shell executor's access model is the exact opposite of how production CI/CD should
work. In production, the pipeline would have scoped, credential-managed access to specific
resources. Here, the runner has everything the Mac user has. That is a security concern in
production — and a convenience in local development that makes the pipeline immediately
functional without configuration overhead.

Recognizing which tradeoffs are acceptable at which stage is part of engineering judgment.

---

### On the Minikube Docker Socket Error Being Diagnostic, Not Fatal

`minikube status` returned an error referencing
`/Users/anshumanmohapatra/.colima/default/docker.sock` — a Colima socket path rather than
Docker Desktop's socket path. The job still succeeded because `minikube status` exiting
with a non-zero code did not cause the job to fail (the script continued).

The error is informative: it means Minikube was previously started with Colima as the
driver, and that context persists in Minikube's configuration. When the deployment pipeline
is built, the active Docker context will need to be aligned — either by starting Minikube
with Docker Desktop as the driver, or by setting the Docker context explicitly in the
pipeline job.

This is the kind of environment-specific detail that appears when running CI/CD on a
developer machine rather than a dedicated CI server. The pipeline exposed it. The
documentation records it. The fix will be applied when the deployment stage is built.

---

### On GitLab as Platform vs Jenkins as Platform

The choice between GitLab CI/CD and Jenkins is not purely technical — it is also an
operational question. Jenkins requires infrastructure to run. GitLab CI/CD requires only
a runner. For a project where the engineering value is in the pipeline content (what it
does) rather than the pipeline platform (what runs it), minimizing operational overhead
is the right tradeoff.

The pipeline responsibilities — security scanning, image building, registry push, and
Kubernetes deployment — are the same regardless of platform. The skills transfer.

---

## Phase 8 — Status: In Progress (Phase 8A Complete)

Runner is operational, Docker and kubectl are accessible, first pipeline succeeded.
Phase 8B begins the real DevSecOps pipeline: compilation verification and GitLeaks.

---

## Phase 8 — GitLab CI/CD (continued)

### On Exit Codes as the Real Language of CI/CD

The minikube bug was the most instructive failure in Phase 8 so far. The pipeline
consistently failed with exit status 7 across every push. The temptation was to assume
the sonarcloud-analysis job was failing — but the job log showed the failure happened in
`runner-verification`, before sonarcloud-analysis ever ran.

Exit code 7 is the story: `minikube status` returns 7 when the cluster is stopped. That
is not an error in the traditional sense — it is a status code. But CI/CD pipelines
treat any non-zero exit from a script command as a failure. The fix was one word: `true`.

This revealed an important distinction between interactive shell usage and CI/CD shell
usage. In an interactive terminal, `minikube status` returning exit 7 with a status
report is useful information. In a CI/CD pipeline, it is a job failure that blocks
every downstream stage. Status-checking commands in pipelines need explicit exit code
handling.

---

### On YAML Multi-Line Continuation Not Being Shell Multi-Line

The variable expansion failure (`URI with undefined scheme`) was a YAML-to-shell
translation problem. Writing:
```yaml
- sonar-scanner
  -Dsonar.host.url=$SONAR_HOST_URL
```
looks like shell argument continuation. It is not. In GitLab CI YAML, each `- ` item
is an independent shell command. The continuation lines are string continuations in
YAML, not shell argument passing.

Shell multi-line commands in CI YAML require explicit `\` continuation:
```yaml
- sonar-scanner \
  -Dsonar.host.url=$SONAR_HOST_URL
```
Or, more simply, a single line. The lesson: YAML and shell have different multi-line
semantics, and they do not compose transparently.

---

### On the Value of Reading Actual Error Output

All three Phase 8.7 failures were diagnosed from actual error messages, not guesses:

- "exit status 7" → `minikube status` exit code → `|| true` fix
- "URI with undefined scheme" → variable not expanding → single-line fix
- "HTTP 403 Forbidden" → wrong token → token rotation fix

Each error message contained the exact failure layer. None required random changes or
repeated retries without understanding. The engineering discipline of reading the actual
output before changing anything made every fix targeted and correct.

---

## Phase 8 — Status: 8.7 Complete, 8.8 Next

SonarCloud analysis is running. The pipeline has 4 stages with 5 jobs, all passing.
Phase 8.8 adds Quality Gate enforcement — making the pipeline fail if code quality
falls below the defined threshold.

---

## Phase 8 — Quality Gate Enforcement (8.8)

### On Token Permissions, API Design, and the Cost of Assumptions

I assumed `sonar.qualitygate.wait=true` would work because the SonarCloud setup guide
presents it as a simple one-line addition. It failed five times. Each failure revealed
a different layer of the problem.

The first failure — exit code 3 "Not authorized" — looked like a token problem. I
regenerated the token. Same failure. Regenerated again. Same failure. Eventually I
stopped treating it as a token problem and started reading the actual error more carefully.
The error said "Not authorized" — but the analysis upload had already succeeded using the
same token. That contradiction was the clue. The token was valid for uploading analysis
but not for the internal QG polling that `sonar.qualitygate.wait` uses. SonarCloud's
permission model has two different auth paths: one for submitting analysis (project-scoped)
and one for querying QG results via the internal scanner mechanism (org-level). The
documentation doesn't surface this distinction clearly.

Once I bypassed sonar-scanner's internal polling and called the API directly with `curl`,
authentication worked. But then a different problem appeared: the QG status was always
`NONE`. I thought it was timing — not enough wait time. The polling loop still returned
`NONE` after 3 minutes. That was when I read the scanner log more carefully:

```
Detected project binding: NOT_BOUND
Branch name: main, type: short
```

These two lines together explained everything. SonarCloud doesn't evaluate Quality Gates
on "short-lived" branches. Without a binding to a Git provider, SonarCloud doesn't know
which branch is the main branch — so it classifies all branches as short-lived. The gate
was never computed. It wasn't slow. It was skipped entirely. Polling `projectKey` for a
short-lived branch returns `NONE` permanently.

The fix — querying by `analysisId` instead of `projectKey` — was based on the understanding
that the CE task response contains a direct pointer to the analysis result. Using that
pointer bypasses the branch classification step. But even that hit a wall: the free plan
returns "Organization is not allowed to access data from non main branches" even for
analysisId-based queries.

At that point, the right decision was to accept the limitation rather than fight it. The
analysis runs. The results are on the dashboard. The enforcement infrastructure is correct
and complete — it will work automatically when the project is bound to GitLab. Blocking
the pipeline because of a billing restriction would have been the wrong call.

What I understand now that I didn't before: SonarCloud's "main branch" concept is not
determined by the branch name. It is determined by the project's binding to a Git provider.
A branch named `main` is still "short-lived" to SonarCloud if the project has no binding.
The branch name and the branch type are independent concepts in SonarCloud's model.

---

## Phase 8 — Status: 8.5 through 8.8 Complete

Pipeline: 5 jobs across 4 stages, all passing on every push.

```
verify → validate → secret-scan → code-quality
  │           │           │              │
runner-    validate-   gitleaks-   sonarcloud-
verif.     frontend    scan        analysis
           validate-
           backend
```

Remaining Phase 8 work: Trivy FS scan (8.9), Docker builds (8.10–8.11), Trivy image
scans (8.12), Docker Hub push (8.13), Kubernetes deployment (8.14), rollout verification
(8.15), failure/recovery exercises (8.16).
