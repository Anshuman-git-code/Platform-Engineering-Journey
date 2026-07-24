# Phase 2A — Image Construction

## Why docker build Exists

Phase 1 established how to run existing images — nginx, hello-world — images that were already built and published to Docker Hub. Phase 2 addresses a different problem: how does an application that exists only as source code on a developer's filesystem become a Docker image?

`docker build` is the answer. It exists to transform application source code into a reusable, portable, executable image.

This distinction is important. `docker run` is concerned with execution — taking an existing image and producing a running container. `docker build` is concerned with construction — taking source code, a runtime, dependencies, and configuration, and assembling them into an image that can be executed anywhere.

The engineering value of `docker build` is captured in the principle: **build once, run many.**

An image is built once, in a controlled environment. That exact image — with that exact runtime version, those exact dependencies, that exact configuration — is then deployed to development, staging, and production environments. Every environment runs from the identical artifact. Environment inconsistency is eliminated at the image level rather than managed at the deployment level.

---

## Build Time vs Run Time

One of the most important conceptual distinctions in Docker is the difference between build time and run time. Conflating the two produces incorrect Dockerfiles and misunderstood container behavior.

```
SOURCE CODE
    │
    ▼
┌─────────────────────────────────┐
│           BUILD TIME            │
│                                 │
│  docker build executes          │
│  Dockerfile instructions        │
│  sequentially                   │
│                                 │
│  Result: immutable image        │
└─────────────────────────────────┘
    │
    ▼
IMAGE (stored in local image store)
    │
    ▼
┌─────────────────────────────────┐
│           RUN TIME              │
│                                 │
│  docker run creates a           │
│  container from the image       │
│                                 │
│  CMD executes                   │
│  Application starts             │
│  Serves traffic                 │
└─────────────────────────────────┘
    │
    ▼
RUNNING CONTAINER
```

**Build time** is when `docker build` executes. Every `RUN`, `COPY`, `WORKDIR`, and `FROM` instruction in the Dockerfile executes during this phase. The result is a static image. No application is running. No ports are open. No traffic is being served. The build phase exists purely to assemble the artifact.

**Run time** is when `docker run` executes against that image. The `CMD` instruction executes at this point — not during the build. The application starts, the process runs, and the container serves its purpose.

This distinction has a direct engineering consequence: installing dependencies belongs to build time. Starting the application belongs to run time. A Dockerfile that runs `npm install` as its `CMD` is reinstalling dependencies on every container start — which defeats the purpose of building an image.


---

## Dockerfile as a Build Recipe

A Dockerfile is an ordered build recipe. It is a sequence of instructions that Docker executes one by one to assemble an image. The order is not arbitrary — it is an engineering decision that directly affects build performance, cache behavior, and image correctness.

Each instruction in a Dockerfile follows the same pattern:

```
Instruction executes
        │
        ▼
Filesystem changes produced
        │
        ▼
Filesystem snapshot taken
        │
        ▼
Layer created
        │
        ▼
Next instruction executes on top of previous layer
```

The final image is the cumulative result of all layers stacked in order. Each layer represents the filesystem delta produced by its corresponding instruction. Layers below are never modified by instructions above — they are immutable once created.

This layered model has two significant engineering consequences:

First, images are composable. A base image layer (an operating system) can be shared between dozens of application images. Docker Engine stores each unique layer only once and reuses it across all images that reference it. This reduces storage consumption and download time.

Second, layers are cacheable. If a layer's input has not changed since the last build, Docker reuses the cached layer instead of re-executing the instruction. This makes incremental builds fast — only the layers whose inputs changed need to be rebuilt.

---

## Image Design Before Dockerfile

Before writing a single line of a Dockerfile, the engineering approach is to identify what the image must contain. Writing a Dockerfile without this design step produces an image built by guesswork — missing components discovered only at runtime, unnecessary components discovered only when investigating image size.

For the backend API (Node.js + Express), the following requirements were identified before any Dockerfile syntax was considered:

| Requirement | Reason |
|---|---|
| Linux operating system | Provides the base environment and kernel interface |
| Node.js runtime | Required to execute JavaScript server-side code |
| npm | Required to install declared dependencies |
| `package.json` | Declares the dependency manifest |
| `package-lock.json` | Locks exact dependency versions for reproducible installs |
| Application source code | The actual code to be executed |
| Installed dependencies (`node_modules`) | Runtime libraries the application requires |
| Startup command | Instruction to start the application process |

This requirement list directly maps to Dockerfile instructions. The design exercise converts application knowledge into infrastructure requirements before any syntax is written.


---

## Layer Thinking

Docker does not execute a Dockerfile as a script. It executes it as a sequence of filesystem transformation steps, each producing a distinct, immutable layer.

Understanding this model requires thinking about what each instruction produces — not what it does.

```
FROM node:22-alpine
        │
        ▼
Layer 0: Complete Linux + Node.js filesystem

WORKDIR /app
        │
        ▼
Layer 1: /app directory created, working directory set

COPY package*.json ./
        │
        ▼
Layer 2: package.json and package-lock.json present in /app

RUN npm install
        │
        ▼
Layer 3: node_modules directory populated in /app

COPY . .
        │
        ▼
Layer 4: All application source files present in /app

CMD ["node", "app.js"]
        │
        ▼
(No new layer — CMD is metadata, not a filesystem change)
```

Each layer is a snapshot of filesystem changes relative to the layer beneath it. When a container is created from this image, all layers are combined into a single unified filesystem view. The container adds one additional writable layer on top for runtime changes — the image layers themselves remain immutable.

This model explains why layer order is an engineering decision, not a stylistic preference. Layers that change frequently should appear later in the Dockerfile. Layers that are stable should appear earlier so they remain cached across builds.

---

## Layer Cache

The Docker layer cache is one of the most impactful performance mechanisms in the build process. Understanding it correctly is the difference between builds that complete in seconds and builds that reinstall all dependencies from scratch on every code change.

The critical principle:

> Docker does not ask: "Did this instruction change?"
> Docker asks: "Did the **input** for this instruction change?"

For `COPY` instructions, the input is the content of the files being copied. If those files have not changed, the layer is served from cache. For `RUN` instructions, the input is the state of the filesystem at that point — which is determined by all preceding layers.

**The engineering problem this creates:**

Consider a naive Dockerfile that copies all source files before installing dependencies:

```
COPY . .
RUN npm install
```

Every time any source file changes — including `app.js`, a controller, a CSS file — the `COPY . .` layer is invalidated. Because `RUN npm install` depends on that layer, it is also invalidated. npm reinstalls all dependencies on every build, regardless of whether `package.json` changed.

**The engineered solution:**

```
COPY package*.json ./
RUN npm install
COPY . .
```

`package.json` and `package-lock.json` change infrequently — only when dependencies are added or removed. By copying only these files first and running `npm install` before copying the rest of the source, the dependency installation layer remains cached across all source code changes.

When only `app.js` changes, the build proceeds as follows:

```
FROM node:22-alpine        → cache hit
WORKDIR /app               → cache hit
COPY package*.json ./      → cache hit (package.json unchanged)
RUN npm install            → cache hit (input layer unchanged)
COPY . .                   → cache MISS (app.js changed)
CMD [...]                  → evaluated from this point forward
```

Four of five layers are served from cache. Only the final source copy executes. The build completes in seconds rather than minutes.

This instruction ordering is the single most important structural optimisation in a Node.js Dockerfile. It is not a convention — it is an engineering decision derived from understanding how the layer cache operates.


---

## Build Context

When `docker build .` is executed, the `.` at the end is not a trivial argument. It defines the **build context** — the set of files that Docker makes available to the build process.

Docker does not read files from arbitrary locations on the host filesystem. It reads only from the build context. When the build starts, Docker packages the entire build context directory and sends it to Docker Engine. From that point forward, every `COPY` instruction in the Dockerfile copies files from the build context, not from the host filesystem directly.

```
Host Filesystem
      │
      │  docker build .
      ▼
Build Context (contents of current directory)
      │
      │  sent to Docker Engine
      ▼
Docker Engine
      │
      │  executes Dockerfile instructions
      │  COPY reads from build context
      ▼
Image
```

This architecture has a direct consequence: if a file is not in the build context, it cannot be copied into the image. A Dockerfile that references a file outside the build context directory will fail.

It also has a performance and security consequence: if the build context contains large or sensitive files that are not needed in the image, they are still transmitted to Docker Engine unnecessarily. This is why `.dockerignore` exists — to exclude files from the build context before transmission.

The first `.` in `COPY . .` refers to the build context root. The second `.` refers to the current working directory inside the image (set by `WORKDIR`). The instruction means: copy everything from the build context into the image's working directory.

---

## Engineering Conclusions

Phase 2A produced several engineering principles that apply beyond Docker to any build and packaging system:

**Design before implementation.** Identifying what an image must contain before writing a Dockerfile produces a cleaner, more intentional implementation than writing instructions and discovering missing components at runtime.

**Understand the build model before writing instructions.** The layered filesystem model, the cache mechanism, and the build context concept are not Docker-specific trivia. They are the engineering model that explains why every Dockerfile instruction is written the way it is.

**Instruction order is an engineering optimisation.** The sequence of Dockerfile instructions determines cache behavior. Stable instructions belong at the top. Frequently changing instructions belong at the bottom. This principle produces builds that are fast in the common case — incremental source changes — without sacrificing correctness.

**Build context is a security boundary.** Everything in the build context is available to the build process. Sensitive files — environment variables, credentials, private keys — must be explicitly excluded. This is not a convenience concern. It is a security requirement.

**Build time and run time have different responsibilities.** Installation, compilation, and asset preparation belong to build time. Application startup belongs to run time. Mixing these responsibilities produces images that are slow to start, difficult to debug, and violate the principle of reproducible builds.
