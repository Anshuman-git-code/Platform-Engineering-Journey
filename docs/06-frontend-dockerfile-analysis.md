# Phase 3 — Frontend Containerization

## Objective

Phase 3 addresses a fundamentally different class of containerization problem from Phase 2. The backend is a long-running server process: Node.js starts, opens a port, and handles requests indefinitely. The frontend is a compiled artifact: React source code is transformed into static files by a build tool, and those files are then served by a file server. Node.js is involved in the build but is completely absent from the runtime.

Understanding this distinction — build tool versus runtime, compiler versus server, dynamic execution versus static file serving — is the primary engineering concept of Phase 3. Everything else is application of Docker knowledge already established in Phase 2.

---

## The Frontend Execution Model

### Engineering Problem

A React application exists as source code: JSX files, TypeScript, CSS modules, imports, and component trees. The question is whether a browser can execute that source code directly.

It cannot. For two reasons.

**JSX is not standard JavaScript.** A React component written as:

```jsx
function App() {
  return <div>Hello World</div>;
}
```

is not valid JavaScript. The `<div>Hello World</div>` syntax is JSX — a syntax extension that must be transformed into standard JavaScript function calls before any browser can execute it:

```javascript
function App() {
  return React.createElement("div", null, "Hello World");
}
```

This transformation is performed by a build tool (Webpack, Vite, or equivalent) during the build phase. The browser never receives JSX.

**The module system is not browser-native.** React source code uses ES module imports across dozens of files:

```javascript
import App from './App';
import { useState } from 'react';
import axios from 'axios';
```

Browsers can handle ES modules, but not the way a development project uses them — with hundreds of files, node_modules resolution, path aliases, and deep import trees. The build tool resolves all imports, bundles related code together, and produces a small number of optimised files.

### What npm run build Produces

The build process transforms the source tree into a browser-ready static website:

```
src/                         build/
├── App.jsx                  ├── index.html
├── index.js          →      ├── static/
├── components/              │   ├── js/
├── pages/                   │   │   └── main-84f7ab.js
└── styles/                  │   └── css/
                             │       └── style-213cd.css
                             └── logo.png
```

The output files are ordinary HTML, CSS, JavaScript, and assets. There is no React runtime in the container. There is no Node.js executing anything. The browser downloads these files and executes the JavaScript locally. The container's only responsibility is to serve the files when requested.

### The Critical Distinction from the Backend

```
Backend Runtime Model:
Source Code → Node.js → Executes permanently → Handles each request

Frontend Runtime Model:
Source Code → Build Tool → Static Files → File Server → Browser downloads and executes
```

Node.js is the application in the backend. In the frontend, Node.js is the compiler. Once compilation is complete, Node.js is no longer needed. The production container does not require Node.js at all.

This distinction produces a fundamentally different Dockerfile architecture.

---

## Why Nginx Serves the Frontend

### Engineering Problem

The build output is a set of static files. Something must serve them over HTTP. The question is what.

Node.js could serve static files — the `express.static` middleware exists for this purpose. But running a Node.js runtime to serve files that require no JavaScript execution is engineering waste. Node.js brings:

- A JavaScript engine
- An event loop
- A module resolution system
- Hundreds of megabytes of runtime overhead

None of which is needed to read a file from disk and return it over HTTP.

Nginx is a purpose-built HTTP server optimised for exactly this task. Its operation for static content is:

```
Request received: GET /
      │
      ▼
Locate file: /usr/share/nginx/html/index.html
      │
      ▼
Read file from disk
      │
      ▼
Return file over HTTP
```

No application logic executes. No language runtime is involved. Nginx performs this operation faster, with less memory, and with greater concurrency than any general-purpose runtime serving static content. For a container whose only job is to serve pre-built files, Nginx is the correct choice.

---

## Image Design Before Dockerfile

Following the same discipline applied in Phase 2, the image requirements were identified before examining any Dockerfile syntax.

A production frontend container requires:

| Requirement | Needed at Build Time | Needed at Runtime |
|---|---|---|
| Linux operating system | Yes | Yes |
| Node.js runtime | Yes — JSX transformation, bundling | No |
| npm | Yes — install dependencies | No |
| `package.json` / `package-lock.json` | Yes — dependency manifest | No |
| React source code (`src/`) | Yes — input to build tool | No |
| Built static files (`build/`) | Produced by build | Yes — served to browser |
| Nginx | No | Yes — serves static files |

The build requirements and the runtime requirements share no components. This structural separation is what makes multi-stage builds not just useful but necessary for correct frontend containerization. A single-stage image would either include Node.js in production (unnecessary and insecure) or omit it and fail to build.

---

## Multi-Stage Builds — Engineering Motivation

### Engineering Problem

A single-stage Dockerfile cannot satisfy both build-time requirements (Node.js, npm, source code, all dependencies) and production requirements (Nginx, built static files only) without including everything in one image.

A single-stage approach would produce:

```
nginx:alpine + Node.js + npm + node_modules + React source + build output
```

Node.js alone adds ~156MB. `node_modules` for a React project adds hundreds of megabytes. The production image would carry substantial weight that serves no runtime purpose and presents additional attack surface.

### The Multi-Stage Solution

Docker supports multiple `FROM` instructions in a single Dockerfile. Each `FROM` begins a new stage with its own base image, its own filesystem, and no inheritance from previous stages. The only way content moves between stages is via an explicit `COPY --from` instruction.

```
Stage 1 (builder)                Stage 2 (runtime)
─────────────────                ─────────────────
node:22-alpine                   nginx:alpine
WORKDIR /app                     
COPY package files               
RUN npm ci                       
COPY source                      
RUN npm run build    ──────────►  COPY --from=builder /app/build
└─ produces /app/build            └─ /usr/share/nginx/html
                                 EXPOSE 80
                                 CMD nginx
```

Stage 1 exists to produce `build/`. Stage 2 exists to serve `build/`. Stage 1 is discarded after the build completes. The final image contains only Stage 2's filesystem — Nginx and the static files. Nothing from Stage 1 survives into the final image unless explicitly copied.

---

## Dockerfile Analysis

The complete frontend Dockerfile:

```dockerfile
# Stage 1: Build React App
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

---

## Stage 1 — Builder

### FROM node:22-alpine AS builder

```dockerfile
FROM node:22-alpine AS builder
```

**`node:22-alpine`** — the same base image used for the backend. Provides Node.js 22 on Alpine Linux. Node is required here because `npm ci` and `npm run build` both execute during Stage 1.

**`AS builder`** — assigns a name to this stage. The name is referenced in Stage 2 by the `COPY --from=builder` instruction. Without this name, Docker would require a stage index (0, 1, 2) to reference previous stages. Named stages are more readable and resilient to Dockerfile restructuring.

Stage names are build-time identifiers. They exist only during the `docker build` process. They are not present in the final image and have no runtime significance.

---

### WORKDIR /app

```dockerfile
WORKDIR /app
```

Identical in purpose to the backend. Creates `/app` in the Stage 1 filesystem and sets it as the working directory for all subsequent Stage 1 instructions. All `COPY` operations and `RUN` commands in Stage 1 execute relative to `/app`.

---

### COPY package.json package-lock.json ./

```dockerfile
COPY package.json package-lock.json ./
```

The same cache optimisation strategy applied in Phase 2, applied identically here. Dependency manifests change infrequently relative to source code. Copying them first and installing dependencies before copying source creates a stable cache boundary: the `npm ci` layer is invalidated only when dependencies change, not when source files change.

Note the explicit file list rather than the wildcard `package*.json` used in the backend. Both approaches are valid. The explicit form is unambiguous about which files are copied.

---

### RUN npm ci

```dockerfile
RUN npm ci
```

**Engineering Problem**

`npm install` reads `package.json` and may update `package-lock.json` if version ranges permit a newer satisfying version. In a development environment, this is acceptable behavior. In a production build, it is not.

**What npm ci does**

`npm ci` (Continuous Integration install) enforces strict reproducibility:

1. It reads exclusively from `package-lock.json`, ignoring `package.json` version ranges
2. It deletes the existing `node_modules` directory before installing
3. It installs the exact versions recorded in the lockfile — no resolution, no updates
4. It fails the build if `package.json` and `package-lock.json` are inconsistent

**Why this matters for Docker**

Consider the failure scenario with `npm install`:

```
Developer tests locally with dependency version 1.2.0
Pushes to repository
Docker build runs npm install
npm resolves version range ^1.2.0
New version 1.2.1 was published yesterday with a regression
npm installs 1.2.1
Production container carries untested dependency
Production breaks
```

`npm ci` eliminates this class of failure entirely. The lockfile is the authoritative record of what the developer tested. `npm ci` installs exactly that.

**`package.json` vs `package-lock.json`**

`package.json` is the human-authored dependency manifest. It specifies version ranges:

```json
"react": "^19.1.0"
```

The `^` prefix permits any compatible version — in this case, any `19.x.y` where `x.y >= 1.0`.

`package-lock.json` is the machine-generated exact version record. When npm resolves `^19.1.0` and installs `19.1.0`, it records exactly that version — plus the full dependency tree of every transitive dependency — in the lockfile. Every subsequent `npm ci` installs exactly that resolved set.

The lockfile converts a flexible specification into a reproducible record. `npm ci` enforces that record.

---

### COPY . .

```dockerfile
COPY . .
```

Copies all remaining source files from the build context into `/app` in Stage 1. This is positioned after `RUN npm ci` for the same cache reason as in the backend: source file changes invalidate this layer but leave the dependency installation layer intact.

The build context for Stage 1 is the `client/` directory. It includes `src/`, `public/`, configuration files, and any other project files. A `.dockerignore` should exclude `node_modules/` and `build/` — the former because it would conflict with the clean install performed by `npm ci`, the latter because it is an output directory that should always be generated fresh.

---

### RUN npm run build

```dockerfile
RUN npm run build
```

**Engineering Problem**

JSX, TypeScript, CSS modules, and the module system cannot be sent to a browser as-is. They must be transformed into browser-native HTML, CSS, and JavaScript.

**What this executes**

`npm run build` invokes the project's configured build tool (Webpack via `react-scripts` in this project). The build tool:

1. Resolves all module imports and constructs the dependency graph
2. Transforms JSX into standard JavaScript function calls
3. Applies any configured transpilation (TypeScript, Babel transforms)
4. Bundles related modules into optimised chunks
5. Minifies JavaScript and CSS to reduce transfer size
6. Applies content hashing to filenames for cache busting
7. Produces the `build/` directory containing the complete static website

Node.js is functioning as a compiler in this step — not as an application server. The analogy is TypeScript compilation: the TypeScript compiler (`tsc`) produces JavaScript from TypeScript source, then exits. `npm run build` produces static web assets from React source, then exits. In both cases, the tool's job is complete after producing its output.

After this instruction completes, Stage 1 has accomplished everything it was created to do. The `build/` directory at `/app/build` contains the production website. Node.js, npm, `node_modules`, and `src/` are no longer needed.

---

## Stage 2 — Runtime

### FROM nginx:alpine

```dockerfile
FROM nginx:alpine
```

This instruction begins an entirely new image. Stage 1 is not extended — it is replaced. The new base image is `nginx:alpine`: Nginx on Alpine Linux.

**What this image contains:**
- Alpine Linux base filesystem (~9MB)
- Nginx web server installed and configured
- Default Nginx configuration pointing to `/usr/share/nginx/html` as the document root
- No Node.js
- No npm
- No JavaScript runtime of any kind

**What this image does not contain:**
- Any file from Stage 1
- The React source code
- The `node_modules` directory
- The build tool
- Development dependencies

The Stage 2 filesystem is completely independent of Stage 1. The second `FROM` is not a continuation — it is a fresh start with a different base image.

---

### COPY --from=builder /app/build /usr/share/nginx/html

```dockerfile
COPY --from=builder /app/build /usr/share/nginx/html
```

This is the sole connection between Stage 1 and Stage 2. It is the only instruction where content crosses the stage boundary.

**`--from=builder`** — specifies the source stage by name. Docker locates the intermediate image produced by the `builder` stage and reads from its filesystem.

**`/app/build`** — the source path within Stage 1's filesystem. This directory contains the complete output of `npm run build`: `index.html`, static JavaScript bundles, CSS files, and any assets.

**`/usr/share/nginx/html`** — the destination in Stage 2's filesystem. This is Nginx's document root — the directory Nginx consults when serving HTTP requests.

**What moves and what does not:**

```
Stage 1 filesystem at /app:
├── build/          ← copied to Stage 2
│   ├── index.html
│   ├── static/
│   └── ...
├── src/            ← discarded
├── node_modules/   ← discarded (hundreds of MB)
├── package.json    ← discarded
└── package-lock.json ← discarded
```

Only `/app/build` crosses the stage boundary. Every other artifact from Stage 1 — including the Node.js runtime, the entire `node_modules` directory, and all source code — is permanently discarded. It exists in the intermediate Stage 1 image but never enters the final image.

**After this instruction**, the Stage 2 filesystem contains:
- Nginx and its configuration
- The complete React production build at the document root

That is the entirety of the production image.

---

### EXPOSE 80

```dockerfile
EXPOSE 80
```

Nginx listens on port 80 by default. `EXPOSE 80` records this as image metadata — identical in purpose and behavior to `EXPOSE 5000` in the backend. It is documentation. It does not publish the port, install forwarding rules, or make the container reachable from the host.

Port 80 is the standard HTTP port. The browser default for HTTP connections. When running the container with `-p 3000:80`, traffic arriving at host port 3000 is forwarded to container port 80 where Nginx is listening.

---

### CMD ["nginx", "-g", "daemon off;"]

```dockerfile
CMD ["nginx", "-g", "daemon off;"]
```

**Engineering Problem**

Nginx, by default, starts as a daemon: it launches, forks background worker processes, and the original process exits. In a standard Linux environment, this is the expected behavior — a daemon runs persistently in the background managed by the init system.

In a Docker container, this behavior is fatal. When PID 1 exits (the original Nginx process, after forking workers), Docker detects PID 1 termination and stops the container. The worker processes may still be running, but Docker does not monitor them — it monitors PID 1 exclusively.

**The solution**

`daemon off;` is an Nginx configuration directive that instructs Nginx to remain in the foreground. The process does not fork and does not exit. It stays as PID 1, processing requests, indefinitely.

```
Without daemon off:
docker run → Nginx starts (PID 1) → Nginx forks workers → PID 1 exits → Docker stops container

With daemon off:
docker run → Nginx starts (PID 1) → Nginx stays foreground → Handles requests → Container runs
```

**This is the same PID 1 principle from Phase 1**, applied to different software. The Node.js backend uses exec-form CMD to ensure Node becomes PID 1 and stays running. The Nginx frontend uses `daemon off;` to prevent Nginx from backgrounding itself. The requirement is identical: PID 1 must not exit.

The exec form `["nginx", "-g", "daemon off;"]` ensures Nginx runs as PID 1 directly without a shell wrapper — the same signal-delivery reasoning that governs the backend CMD.

---

## Dependency Reproducibility — npm ci vs npm install

### Engineering Problem

A production container must contain exactly the dependencies that were tested during development. Any deviation introduces risk: a dependency that was not tested may behave differently, contain a regression, or introduce a vulnerability.

### The Lockfile Contract

`package.json` is the human-authored intent — version ranges that express which versions the developer considers acceptable:

```json
"react": "^19.1.0",
"axios": "^1.10.0"
```

`package-lock.json` is the machine-generated exact record — the precise versions installed when the developer last ran npm, including all transitive dependencies:

```json
"react": {
  "version": "19.1.0",
  "resolved": "https://registry.npmjs.org/react/-/react-19.1.0.tgz",
  "integrity": "sha512-..."
}
```

The lockfile removes ambiguity from the range specification. It answers the question: "which specific version was actually installed and tested?"

### npm install vs npm ci

| Behavior | `npm install` | `npm ci` |
|---|---|---|
| Reads version ranges from | `package.json` | `package-lock.json` |
| May install newer versions | Yes, if range permits | No — lockfile is authoritative |
| May modify `package-lock.json` | Yes | No — fails if inconsistent |
| Deletes existing `node_modules` | No | Yes — clean install |
| Suitable for production builds | No | Yes |

`npm install` in a Dockerfile introduces the possibility that a build executed tomorrow installs different versions than a build executed today. A new patch release published overnight satisfies the `^` version range. The Docker build picks it up automatically. The container carries untested code.

`npm ci` eliminates this possibility. It installs the lockfile exactly. A build executed in six months installs the same versions as a build executed today, assuming the lockfile has not changed.

---

## Multi-Stage Build — Engineering Significance

### What the Final Image Contains

After the build completes, `docker images` will show the frontend image at a fraction of the size it would be with a single-stage build:

```
Single-stage approach:
node:22-alpine + npm + node_modules (~300MB) + source + build output
≈ 600MB+

Multi-stage approach:
nginx:alpine + build output only
≈ 25-30MB
```

The size reduction is not cosmetic. A smaller image:
- Pulls faster from the registry during deployment
- Reduces registry storage cost across many versions
- Has a smaller attack surface — fewer installed packages means fewer potential vulnerabilities
- Starts faster — less data to decompress and mount

### What Stage 1 Leaves Behind

Stage 1 accumulates everything needed for the build:

```
/app/
├── node_modules/    ~300MB  (all React dependencies, build tools, type definitions)
├── src/             (JSX, TypeScript, CSS modules — never needed again after build)
├── package.json     (development artifact)
├── package-lock.json (development artifact)
└── build/           ← the only output that matters
```

None of this except `build/` enters the final image. The 300MB `node_modules` directory, the entire React source tree, every development tool — all of it is discarded at the `FROM nginx:alpine` boundary.

This is the production case for multi-stage builds: use a full development environment to produce an artifact, then start fresh with only the artifact in a minimal runtime environment.

---

## Pre-Build Engineering Predictions

Before building the frontend image, four engineering questions were posed to verify the mental model was complete.

**Why is Node completely absent from the final runtime image?**

Stage 1 and Stage 2 are separate images with no implicit inheritance. The second `FROM nginx:alpine` starts a completely new image. Stage 1 produced its output (`build/`) and was discarded. Stage 2 receives only what is explicitly copied via `COPY --from=builder`. Node.js was never installed in Stage 2 and therefore cannot be present in the final image.

**If Stage 1 accidentally contained a 2GB log file, would it exist in the final image?**

No. `COPY --from=builder` specifies an exact source path: `/app/build`. Only the contents of that path are copied. Any other file in Stage 1 — regardless of size — is unreachable by Stage 2 and does not enter the final image. Multi-stage isolation is the mechanism that prevents accidental inclusion of build artifacts in production images.

**If `src/App.jsx` changes, what rebuilds?**

```
COPY package.json package-lock.json ./  → cache hit  (manifests unchanged)
RUN npm ci                              → cache hit  (input layer unchanged)
COPY . .                                → cache MISS (App.jsx changed)
RUN npm run build                       → rebuilt    (depends on changed source)
```

Stage 2 then copies the newly generated `build/` output. `npm ci` does not rerun. The expensive dependency installation is served from cache. The cache optimisation strategy from Phase 2 applies identically.

**What is inside `/usr/share/nginx/html` after `COPY --from=builder`?**

`/usr/share/nginx/html` is Nginx's document root — the directory Nginx reads from when serving HTTP requests. After the `COPY --from=builder` instruction, it contains the complete React production build:

```
/usr/share/nginx/html/
├── index.html
├── static/
│   ├── js/
│   │   └── main-84f7ab.js
│   └── css/
│       └── style-213cd.css
└── favicon.ico
```

When a browser requests `GET /`, Nginx reads `index.html` from this directory and returns it. When the browser requests `/static/js/main-84f7ab.js`, Nginx reads that file and returns it. Nginx requires no configuration for this behavior — the document root is set by default in the `nginx:alpine` base image.

---

## Frontend Image Build — Execution and Analysis

### Execution

```bash
cd client/
docker build -t frontend:v1 .
```

### Build Context Transmission

```
Sending build context to Docker daemon  337.3MB
```

The build context is substantially larger than the backend's 5.224MB. The `client/` directory contains `node_modules/` from local development. Without a `.dockerignore` excluding it, the entire local `node_modules` tree is transmitted to Docker Engine before the build begins. This is transmission overhead — the local `node_modules` is never used during the build because `npm ci` performs a clean install inside the container. A properly configured `.dockerignore` would reduce this to a few megabytes.

### Step-by-Step Analysis

**Step 1 — FROM node:22-alpine AS builder**

```
Step 1/10 : FROM node:22-alpine AS builder
 ---> c610fcdfb1d5
```

Cache hit — `node:22-alpine` was pulled during the backend build. Docker reused the locally stored image. No download occurred. The Stage 1 filesystem begins from the same Node base used by the backend.

**Step 2 — WORKDIR /app**

```
Step 2/10 : WORKDIR /app
 ---> Using cache
 ---> d90ce4a4e4e6
```

Cache hit — and notably the same layer hash `d90ce4a4e4e6` as the backend's WORKDIR instruction. This illustrates Docker's content-addressable storage: `WORKDIR /app` on `node:22-alpine` produces the same filesystem change regardless of which project it belongs to. The layer is shared.

**Step 3 — COPY package.json package-lock.json ./**

```
Step 3/10 : COPY package.json package-lock.json ./
 ---> f73790df97c5
```

Cache miss — new layer. The frontend's `package.json` and `package-lock.json` differ from the backend's. A new layer is produced.

**Step 4 — RUN npm ci**

```
Step 4/10 : RUN npm ci
 ---> Running in 3c331bb4bbb7
added 1350 packages, and audited 1351 packages in 55s
 ---> Removed intermediate container 3c331bb4bbb7
 ---> 8ac372b5178b
```

1350 packages installed — compared to 99 for the backend. This difference is significant and expected. The React frontend requires an entire build toolchain at install time: Webpack, Babel, ESLint, PostCSS, testing libraries, source map generators, and their transitive dependencies. These are all `devDependencies` that exist solely to support the build process.

None of these packages will be present in the final image. The 1350-package `node_modules` is a build-time artifact that exists only within Stage 1. This is the primary justification for multi-stage builds: the build environment is inherently heavy; the runtime environment does not need to be.

The deprecation warnings in the npm output are package maintenance notices unrelated to Docker. They indicate that certain transitive dependencies have issued deprecation notices through newer versions of the packages that reference them. They do not affect build correctness or container functionality.

**Step 5 — COPY . .**

```
Step 5/10 : COPY . .
 ---> bdfbc8003ba5
```

All source files from the build context copied into `/app` in Stage 1. This includes `src/`, `public/`, configuration files, and all project source.

**Step 6 — RUN npm run build**

```
Step 6/10 : RUN npm run build
 ---> Running in 2ebd2443bb59
> client@0.1.0 build
> react-scripts build
Creating an optimized production build...
Compiled with warnings.
File sizes after gzip:
  88.27 kB  build/static/js/main.fe8d536d.js
  2.33 kB   build/static/css/main.3aa1d2fd.css
The build folder is ready to be deployed.
 ---> Removed intermediate container 2ebd2443bb59
 ---> 4434e72a4c4f
```

`react-scripts build` executed inside a temporary container. The build tool resolved all module imports, transformed JSX into standard JavaScript, bundled and minified the application, and produced the `build/` directory.

The build output reports gzipped file sizes — these are the sizes browsers will download:
- `main.fe8d536d.js` — 88.27 kB: the complete React application, all components, routing, and axios, bundled and minified
- `main.3aa1d2fd.css` — 2.33 kB: all styles

The content hash in the filename (`fe8d536d`, `3aa1d2fd`) is generated by the build tool. It changes whenever the file content changes, which invalidates browser caches automatically. Old files are never served after a deployment because the filenames differ.

The ESLint warning about `useEffect` in `UserDashboard.js` was noted in Phase 0 and carried forward. It is a code quality notice, not a build failure.

Stage 1 is complete. Node.js has fulfilled its role as a compiler. The `build/` directory at `/app/build` is the only artifact that matters.

**Step 7 — FROM nginx:alpine**

```
Step 7/10 : FROM nginx:alpine
 ---> 4a73073bd557
```

Stage 2 begins. Docker discards the entire Stage 1 filesystem — including 1350 packages, all React source code, and the Node.js runtime. The new base image is `nginx:alpine`, already cached locally from Phase 1. The Stage 2 filesystem starts completely fresh from this image.

**Step 8 — COPY --from=builder**

```
Step 8/10 : COPY --from=builder /app/build /usr/share/nginx/html
 ---> fe88c8585aae
```

The sole transfer between stages. Docker reads `/app/build` from the Stage 1 intermediate image and writes its contents to `/usr/share/nginx/html` in Stage 2. The React production build — approximately 90kB of JavaScript and CSS — crosses the stage boundary. The remaining hundreds of megabytes from Stage 1 do not.

**Steps 9 and 10 — EXPOSE and CMD**

```
Step 9/10 : EXPOSE 80
 ---> 3fb1ee2c06ce
Step 10/10 : CMD ["nginx", "-g", "daemon off;"]
 ---> 1400397487e6
Successfully built 1400397487e6
Successfully tagged frontend:v1
```

Port 80 metadata recorded. Nginx startup command stored as image configuration. Final image ID: `1400397487e6`. Tagged as `frontend:v1`.

---

## Image Size Analysis

```
IMAGE        ID             DISK USAGE   CONTENT SIZE
frontend:v1  1400397487e6   94.4MB       26.5MB
nginx:alpine 4a73073bd557   92.8MB       26.9MB
```

**The most significant observation from Phase 3:**

Stage 1 installed 1350 packages. `node_modules` for a React project with a full build toolchain occupies approximately 300–400MB. `npm run build` produced an additional layer. Yet the final image is only ~1.6MB larger than the `nginx:alpine` base image.

The entire build environment — 1350 packages, the Node.js runtime, all React source code — was used, fulfilled its purpose, and was discarded. It added zero bytes to the production image.

This is the direct, measurable proof that multi-stage builds function exactly as designed.

**Backend vs frontend size comparison:**

| Image | Size | Runtime |
|---|---|---|
| `backend:v1` | 257MB | Node.js (must run permanently) |
| `frontend:v1` | 94.4MB | Nginx (serves static files) |
| `nginx:alpine` (base) | 92.8MB | — |
| `node:22-alpine` (base) | 229MB | — |

The frontend production image is smaller than the backend production image despite requiring a far larger build toolchain, because the build toolchain is excluded from the runtime image entirely.

---

## Container Runtime Verification

### Execution

```bash
docker run -d --name frontend-test -p 3000:80 frontend:v1
```

Port mapping: host port 3000 → container port 80. Browser traffic arriving at `localhost:3000` on the host is forwarded to Nginx listening on port 80 inside the container.

**Browser result:** The React application loaded and rendered correctly at `http://localhost:3000`. This confirms the complete delivery chain:

```
npm run build → build/ → COPY --from=builder → /usr/share/nginx/html
      │
      ▼
docker run -p 3000:80
      │
      ▼
Browser: GET localhost:3000
      │
      ▼
Host networking → Docker port forwarding rule
      │
      ▼
Container port 80 → Nginx
      │
      ▼
/usr/share/nginx/html/index.html → served to browser
      │
      ▼
Browser executes JavaScript → React application renders
```

Every stage of the pipeline — build, package, deploy, serve — produced the correct output.

---

## Internal Container Inspection

### Execution

```bash
docker exec -it frontend-test sh
```

Alpine Linux uses `sh`. bash is not installed.

### Commands and Observations

**pwd**

```
/
```

Stage 2 has no `WORKDIR` instruction. The shell opens at the root of the filesystem. This directly confirms stage isolation: `WORKDIR /app` was set in Stage 1 only. Stage 2 begins from the `nginx:alpine` base image with no inherited working directory configuration.

**ls /usr/share/nginx/html**

```
asset-manifest.json  favicon.ico  index.html  logo192.png  logo512.png  manifest.json  robots.txt  static/
```

The `build/` output from `npm run build` is present. `index.html` is the entry point Nginx will serve for `GET /`. The `static/` directory contains the hashed JavaScript and CSS bundles. These are exactly the files the browser requested when the application loaded.

**cat /etc/os-release**

```
NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.22.0
```

The runtime OS is Alpine Linux. No Node.js. No React. No build tools. The container runs Alpine and Nginx — nothing else.

**ps**

```
PID   USER     TIME  COMMAND
    1 nginx     0:00 nginx: master process nginx -g daemon off;
   31 nginx     0:00 nginx: worker process
   32 nginx     0:00 nginx: worker process
```

**PID 1 is the Nginx master process.** The same PID 1 principle observed in Phase 2B with Node.js applies identically here with Nginx. The container's lifetime is tied to this process.

Nginx runs as a master-worker architecture: the master process (PID 1) manages configuration and worker lifecycle; worker processes handle incoming HTTP connections. This architecture allows Nginx to serve concurrent requests across multiple CPU cores efficiently. When `docker stop` sends SIGTERM, the master process coordinates a graceful shutdown of all workers.

The shell (`sh`) opened by `docker exec` is not visible here because it opened in a separate invocation with its own PID. The two worker processes confirm Nginx is actively serving.

**nginx -v**

```
nginx version: nginx/1.28.0
```

The Nginx version installed in the `nginx:alpine` image. No JavaScript runtime. No application framework. A web server.

### Verification Table

| Dockerfile Instruction | Verification | Result |
|---|---|---|
| `FROM nginx:alpine` | `cat /etc/os-release`, `nginx -v` | Alpine Linux, Nginx 1.28.0 |
| `COPY --from=builder /app/build /usr/share/nginx/html` | `ls /usr/share/nginx/html` | React build files present |
| `CMD ["nginx", "-g", "daemon off;"]` | `ps` | PID 1 is nginx master process |
| Stage isolation (no WORKDIR in Stage 2) | `pwd` | Root filesystem `/` |
| Port 80 → 3000 mapping | Browser `localhost:3000` | Application loads correctly |

---

## Phase 3 Engineering Retrospective

### What Was Built

A production-ready frontend container that:

- Builds the React application from source using a complete Node.js build environment in Stage 1
- Discards the entire build environment after producing the static output
- Serves the static output from a minimal Nginx container in Stage 2
- Exposes port 80 and starts Nginx as PID 1 with daemon mode disabled
- Weighs approximately 94MB total — only ~1.6MB more than the Nginx base image

### Key Observations

**1350 packages at build time, zero at runtime.** The React build toolchain is large by necessity — it transforms source code into optimised browser assets. That toolchain has no runtime purpose and correctly appears nowhere in the production image.

**`pwd` returning `/` proves stage isolation.** The working directory set in Stage 1 does not persist to Stage 2. Every instruction in Stage 2 executes against a fresh filesystem with no memory of Stage 1's configuration.

**The content hash in the filename serves cache busting.** `main.fe8d536d.js` — the hash changes whenever the JavaScript content changes. Browsers that cached the old file will request the new filename automatically. Deployment does not require cache invalidation management.

**PID 1 in Nginx is the master process, not a worker.** Nginx's master-worker architecture means workers handle requests while the master manages the lifecycle. SIGTERM sent to PID 1 (the master) coordinates a clean shutdown of all workers. The `daemon off` directive keeps this master process in the foreground as PID 1 rather than allowing it to background itself.

### What Phase 3 Established

Phase 3 generalised the engineering model from Phase 2. The Docker fundamentals — layers, cache, PID 1, port publishing, image metadata — all applied identically. The new concepts were:

- The build vs runtime distinction for frontend applications (Node as compiler vs Node as server)
- Multi-stage builds as a mechanism for isolating build environments from runtime environments
- `npm ci` as the production dependency installation standard
- Nginx as the appropriate runtime for static file serving
- `daemon off` as the Nginx-specific PID 1 configuration

The phase is complete. Three of the five components in the final Docker Compose deployment are now containerized: the React frontend, the Node.js backend, and (implicitly) the MySQL database which uses an official image without a custom Dockerfile.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Frontend vs backend execution model | Complete |
| Why browsers cannot execute React source code directly | Complete |
| JSX transformation requirement | Complete |
| What `npm run build` produces | Complete |
| Why `src/` is irrelevant at runtime | Complete |
| Why Nginx serves the frontend instead of Node | Complete |
| Image design before Dockerfile | Complete |
| Multi-stage build engineering motivation | Complete |
| Stage 1 analysis — all instructions | Complete |
| `npm ci` vs `npm install` — engineering reasoning | Complete |
| `package.json` vs `package-lock.json` — lockfile contract | Complete |
| Node as compiler vs Node as runtime server | Complete |
| Stage 2 analysis — all instructions | Complete |
| `daemon off` — PID 1 principle applied to Nginx | Complete |
| Multi-stage build size and security advantages | Complete |
| Pre-build engineering predictions — all verified | Complete |
| Frontend image build — execution and output analysis | Complete |
| Build context size observation and `.dockerignore` implication | Complete |
| Image size analysis — multi-stage proof | Complete |
| Container execution and browser verification | Complete |
| Internal container inspection — `docker exec` | Complete |
| `pwd` — stage isolation confirmed | Complete |
| `ls /usr/share/nginx/html` — build output verified | Complete |
| `ps` — Nginx master/worker architecture, PID 1 confirmed | Complete |
| Dockerfile-to-runtime verification table | Complete |
| Phase 3 engineering retrospective | Complete |

### Phase 3 Status: Complete

Phase 3 is closed. The frontend container is built, verified, and understood.

**Next: Phase 4 — Docker Compose**

Phase 4 shifts from individual container management to declarative multi-container orchestration. The frontend, backend, and MySQL containers — each built and verified independently — will be declared in a single `docker-compose.yml` and started as a coordinated application with a shared network, DNS-based service discovery, and persistent volumes. This is also the phase where the MySQL connection failure observed throughout Phase 2B is resolved.
