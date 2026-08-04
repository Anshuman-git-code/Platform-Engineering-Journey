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
