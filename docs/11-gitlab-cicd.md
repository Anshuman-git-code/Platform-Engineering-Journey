# Phase 8 — GitLab CI/CD

## Objective

Phase 8 replaces Jenkins as the CI/CD orchestration platform with GitLab CI/CD while
preserving the original project's complete DevSecOps pipeline responsibilities.

The engineering responsibilities remain identical to the reference project's pipeline:

```
Compile → GitLeaks → SonarQube → Trivy FS → Docker Build
    → Trivy Image → Docker Push → Approval → Kubernetes Deploy → Verify
```

The orchestration platform changes:

```
Jenkins (reference project)
        │
        ▼ REPLACED BY
GitLab CI/CD
```

This is not a simplification. It is a platform migration that preserves every security and
deployment responsibility while gaining GitLab's native CI/CD capabilities: built-in
pipeline visualization, merge request integration, and project runner management.

---

## Why GitLab Instead of Jenkins

The original reference project uses Jenkins because it demonstrates a widely-used
enterprise CI/CD tool. GitLab CI/CD was chosen as the implementation platform for this
project for specific engineering reasons:

**Self-contained platform.** GitLab hosts both the repository and the CI/CD engine in one
place. Jenkins requires a separate server, separate authentication, and a webhook
integration. For a project already using GitLab for repository hosting, using GitLab CI/CD
eliminates the operational overhead of maintaining a Jenkins instance.

**Runner on local Mac.** The self-hosted GitLab Runner on Apple Silicon macOS gives the
pipeline direct access to the local Docker Engine, kubectl, and Minikube cluster — the
same environment where the application has been built and verified throughout Phases 1–7.
This makes Kubernetes deployment from the CI pipeline immediately viable without any
additional infrastructure.

**Native YAML pipeline definition.** `.gitlab-ci.yml` sits in the repository alongside the
application code. The pipeline definition is version-controlled, reviewed in merge requests,
and linked to the commits it builds. The pipeline and the application evolve together.

---

## Target Architecture

```
Developer
    │
    │ git push → main
    ▼
GitLab.com
    │ pipeline triggered
    ▼
Self-Hosted GitLab Runner (Apple Silicon Mac)
    │
    │ shell executor — runs directly on the Mac
    ├── Docker Engine (build, scan, push)
    ├── kubectl (deploy to cluster)
    └── Minikube (local Kubernetes cluster)
```

The runner uses the **shell executor** rather than Docker-in-Docker or a container executor.
This gives pipeline jobs direct access to the Mac's Docker daemon and Minikube cluster
without any additional configuration. GitLab explicitly documents the shell executor as the
supported approach for macOS runners.

**Security note:** The shell executor runs jobs with the Mac user's full environment. This
provides substantial host access. This is intentional for a local learning environment with
Minikube as the deployment target. This architecture would not be used for production
deployments to AWS EKS, where an isolated container executor and proper secret management
would be required.

---

## Phase 8 Roadmap

```
Phase 8A — GitLab Foundation          ← CURRENT
    GitLab project
    Self-hosted runner on Mac
    Runner verification pipeline

Phase 8B — Basic CI
    Frontend compilation verification
    Backend compilation verification
    GitLeaks secret scanning

Phase 8C — Security Scanning
    SonarQube static analysis
    Quality Gate enforcement
    Trivy filesystem scan

Phase 8D — Container Build
    Backend Docker image build
    Frontend Docker image build

Phase 8E — Image Security
    Trivy image scan (backend)
    Trivy image scan (frontend)

Phase 8F — Registry Push
    Docker Hub push (backend)
    Docker Hub push (frontend)

Phase 8G — Kubernetes Deployment
    kubectl apply to Minikube
    Rolling update verification

Phase 8H — Deployment Verification
    Pod health check
    Service endpoint verification
    Application response verification

Phase 8I — Failure Exercises
    Deliberate pipeline failures
    Debugging CI/CD layer vs application layer
```

---

## Phase 8A — GitLab Foundation

### Step 1 — Two-Remote Repository Architecture

The project maintains two remotes simultaneously:

```
GitHub (origin)                    GitLab (gitlab)
Anshuman-git-code/                 anshuman-group7013835/
Platform-Engineering-Journey       platform-engineering-journey

Public portfolio                   CI/CD platform
Engineering documentation          Pipeline execution
Phase history                      Runner management
```

GitHub remains the public-facing portfolio repository. GitLab becomes the CI/CD engine.
Both remotes receive pushes from the same local repository.

```bash
git remote -v
```

```
gitlab  https://gitlab.com/anshuman-group7013835/platform-engineering-journey.git (fetch)
gitlab  https://gitlab.com/anshuman-group7013835/platform-engineering-journey.git (push)
origin  https://github.com/Anshuman-git-code/Platform-Engineering-Journey.git (fetch)
origin  https://github.com/Anshuman-git-code/Platform-Engineering-Journey.git (push)
```

### Authentication

GitLab requires a Personal Access Token (PAT) for HTTPS Git operations. Passwords are
not accepted. The remote URL is configured with the token embedded:

```bash
git remote set-url gitlab https://<username>:<token>@gitlab.com/<username>/platform-engineering-journey.git
```

The token requires `write_repository` scope at minimum, or `api` scope for full access.

GitLab fine-grained tokens require the **Code: Push** project permission explicitly granted
at token creation time. Standard tokens with `api` scope include this permission implicitly.

### Step 2 — GitLab Runner Installation

GitLab Runner is installed as a binary for Apple Silicon (darwin/arm64):

```bash
sudo curl --output /usr/local/bin/gitlab-runner \
  "https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-darwin-arm64"
sudo chmod +x /usr/local/bin/gitlab-runner
gitlab-runner --version
```

Verified output:
```
Version:      19.3.1
OS/Arch:      darwin/arm64
```

### Step 3 — Runner Registration

A project runner was created in GitLab:
**Project → Settings → CI/CD → Runners → Create project runner**

Tag: `macos`

Registration:

```bash
gitlab-runner register
```

Prompts answered:
```
GitLab instance URL: https://gitlab.com
Token: <runner authentication token from GitLab>
Description: gitlab-runner register
Executor: shell
```

The shell executor was chosen because it runs jobs directly on the Mac host, providing
native access to Docker, kubectl, and Minikube without any container nesting.

Configuration stored at: `~/.gitlab-runner/config.toml`

### Step 4 — Runner as macOS LaunchAgent Service

GitLab documents that on macOS, the runner must be installed as a user-level LaunchAgent,
not a system-level LaunchDaemon. The install and start commands are run from the home
directory as the GUI user:

```bash
cd ~
gitlab-runner install
gitlab-runner start
gitlab-runner status
```

Output:
```
gitlab-runner: Service is running
```

The runner daemon starts automatically with the user's GUI session. Configuration and
logs are stored in the user's home directory:

```
~/.gitlab-runner/config.toml    ← runner configuration
~/gitlab-runner.out.log         ← stdout
~/gitlab-runner.err.log         ← stderr
```

### Step 5 — Runner Verification

```bash
gitlab-runner list
gitlab-runner verify
```

`gitlab-runner verify` confirms the runner is contactable by GitLab.

### Step 6 — Verification Pipeline

Before building the real DevSecOps pipeline, a minimal verification job confirms the
runner has access to the engineering environment:

```yaml
stages:
  - verify

runner-verification:
  stage: verify
  tags:
    - macos
  script:
    - echo "GitLab Runner is working"
    - git --version
    - docker --version
    - kubectl version --client
    - minikube status
```

This job proves:
- Runner accepts jobs tagged `macos`
- Git is available on the host
- Docker Engine is accessible
- kubectl is installed and configured
- Minikube cluster state is accessible

The job was committed and pushed to GitLab:

```bash
git add .gitlab-ci.yml
git commit -m "ci: initialize GitLab runner verification"
git push gitlab main
```

### Verification Pipeline Output

```
Running with gitlab-runner 19.3.1 (a16f5092)
on gitlab-runner register _lRsYVmQE, system ID: s_3b9446573eaf
Using Shell (bash) executor...
Running on Anshumans-MacBook-Air.local...

$ echo "GitLab Runner is working"
GitLab Runner is working

$ git --version
git version 2.39.5 (Apple Git-154)

$ docker --version
Docker version 29.6.0, build fb59821d45

$ kubectl version --client
Client Version: v1.33.2
Kustomize Version: v5.6.0

$ minikube status
E0828 minikube status error: Cannot connect to the Docker daemon at
unix:///Users/anshumanmohapatra/.colima/default/docker.sock.

Job succeeded
```

### Minikube Status Observation

The `minikube status` command returned an error about the Docker socket path
(`/Users/anshumanmohapatra/.colima/default/docker.sock`). This does not indicate a
broken pipeline. It indicates:

1. Minikube was previously started using Colima as the Docker driver
2. Colima was not running at the time the pipeline job executed
3. Docker Desktop was running (confirmed by `docker --version` succeeding)
4. The two Docker contexts have different socket paths

**Engineering significance:** When the real deployment pipeline is built in Phase 8G,
the Minikube cluster must be running with the correct Docker context active when the
runner job executes. The verification pipeline has confirmed the runner can reach Docker
Desktop. The Minikube/Docker context alignment will be addressed when the deployment
stage is implemented.

The job succeeded. The runner is operational. Docker is accessible. kubectl is installed.
The foundation for Phase 8B is confirmed.

---

## Phase 8A Checkpoint — Completed

| Step | Status |
|---|---|
| GitLab project created | ✅ |
| GitLab remote added to local repository | ✅ |
| Main branch pushed to GitLab | ✅ |
| GitLab Runner binary installed (darwin/arm64 v19.3.1) | ✅ |
| Project runner created in GitLab with `macos` tag | ✅ |
| Runner registered with shell executor | ✅ |
| Runner installed as macOS LaunchAgent | ✅ |
| Runner service started and verified | ✅ |
| `.gitlab-ci.yml` verification job created | ✅ |
| Pipeline triggered and job succeeded | ✅ |
| Docker accessible from runner | ✅ |
| kubectl accessible from runner | ✅ |

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| GitLab project creation and two-remote architecture | Complete |
| PAT authentication for GitLab HTTPS push | Complete |
| GitLab Runner installation (darwin/arm64) | Complete |
| Runner registration with shell executor | Complete |
| LaunchAgent service installation | Complete |
| Runner verification | Complete |
| Verification pipeline — `.gitlab-ci.yml` | Complete |
| First successful GitLab pipeline | Complete |
| Docker + kubectl accessibility confirmed | Complete |
| Minikube context issue identified and documented | Complete |

### Remaining — Phase 8 Continuation

| Phase | Topic | Status |
|---|---|
| 8B | Frontend + Backend compilation, GitLeaks | Pending |
| 8C | SonarQube, Quality Gate, Trivy FS | Pending |
| 8D | Backend + Frontend Docker build | Pending |
| 8E | Trivy image scanning | Pending |
| 8F | Docker Hub registry push | Pending |
| 8G | Kubernetes deployment via kubectl | Pending |
| 8H | Deployment verification | Pending |
| 8I | Deliberate failure and debugging exercises | Pending |

### Phase 8 Status: In Progress — Phase 8A Complete

---

## Phase 8.5 — Validation / Compilation

### Engineering Problem

A syntax error in application source code produces a failure at container startup, not at
image build time. `docker build` succeeds because it copies files without executing them.
The error only surfaces when the container starts and the Node.js runtime attempts to parse
the broken file. At that point, the error is deep in the pipeline — after a potentially
expensive image build and push.

Catching syntax errors before any build is cheap: `node --check` parses JavaScript without
executing it. It requires only the Node.js binary. No `npm install`, no build tools, no
dependencies. It runs in seconds and gates the entire pipeline.

### Why `node --check` Instead of `npm test`

The frontend `package.json` has a `test` script (`react-scripts test --watchAll=false`) and
the backend has no test script at all. Both require `npm install` to populate `node_modules`
before they can run, which would need an additional pipeline step.

`node --check` needs nothing beyond the Node.js binary already present on the shell executor.
It is the equivalent of the reference project's "Frontend compilation" and "Backend
compilation" stages — syntax validation before any expensive operation.

### Pipeline Architecture

```
git push → GitLab
        │
        ▼
Self-hosted Runner (shell executor, macOS tag)
        │
        ├── Stage: verify
        │     └── runner-verification (confirms Docker, kubectl reachable)
        │
        └── Stage: validate
              ├── validate-frontend
              │     find client/src -name "*.js" -not -path "*/node_modules/*" -exec node --check {} +
              └── validate-backend
                    find api -name "*.js" -not -path "*/node_modules/*" -exec node --check {} +
```

### Jobs

**`validate-frontend`**
Scans all JavaScript files under `client/src/`, excluding `node_modules`. Uses `node --check`
which parses each file for syntax errors without executing it. The `find ... -exec ... {} +`
form passes all matched files to a single `node --check` invocation, which exits non-zero
if any file contains a syntax error.

**`validate-backend`**
Same approach applied to `api/`. Covers `app.js`, all controllers, middleware, models, and
routes. The `node_modules/` directory is excluded — it contains vendored code, not
application source.

### Local Verification

Both commands were verified locally before pipeline implementation:

```bash
find client/src -name "*.js" -not -path "*/node_modules/*" -exec node --check {} +
# → FRONTEND: all JS files valid (exit 0)

find api -name "*.js" -not -path "*/node_modules/*" -exec node --check {} +
# → BACKEND: all JS files valid (exit 0)
```

Node.js version on runner: `v24.3.0`

### GitLab Pipeline Verification

Pipeline `2798839328` executed on commit `88d9e77`. Runner log confirmed all three jobs:

| Job ID | Job Name | Status | Duration |
|---|---|---|---|
| 16163189133 | runner-verification | success | 5.68s |
| 16163189134 | validate-frontend | success | 4.74s |
| 16163189135 | validate-backend | success | 3.35s |

Evidence from `gitlab-runner.err.log`:
```
job=16163189134 job-status=success   (validate-frontend)
job=16163189135 job-status=success   (validate-backend)
```

### Production Considerations

`node --check` validates syntax only. It does not validate:
- Runtime logic errors
- Missing module imports (surface at container startup)
- React JSX syntax (handled by `react-scripts build` in Phase 8.11)
- TypeScript type errors (not applicable — project uses plain JavaScript)

A more comprehensive validation would add `npm ci` + `npm test` in a separate stage. This
is deferred to a future pipeline hardening iteration after the core DevSecOps pipeline
is complete.

---

## Phase 8.5 Status: Complete

Pipeline confirmed passing on GitLab. Both validation jobs run correctly on the
self-hosted macOS runner.

**Next: Phase 8.6 — GitLeaks secret scanning**
Pre-condition: `brew install gitleaks` on runner Mac.

---

## Phase 8.6 — GitLeaks Secret Scanning

### Engineering Problem

A secret committed to application source code — an API key, database password, private key,
or JWT signing secret — becomes part of the Docker image if it is present at build time.
Even if the secret is removed in a later commit, it remains accessible in any image built
from an earlier commit and in git history. The correct intervention point is before the
image is built: scan application source on every push and fail the pipeline if a secret is
detected.

### False Positive Investigation

Initial testing with `gitleaks detect --source ./client --exit-code 1` (with git history
scanning) produced a detection:

```
File:  docs/02-local-environment-verification.md
Match: token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
Rule:  generic-api-key
```

This is a JWT token example in engineering documentation — not a real secret. GitLeaks
with git history traversal correctly identifies it as a token pattern, but the context
(documentation) means it is not a true positive.

**Engineering decision:** Scope the scan to application source directories only
(`client/src` and `api`) using `--no-git` (filesystem scan, no history traversal). This
scans exactly what will be compiled into Docker images while avoiding false positives from
documentation that intentionally contains token examples.

The trade-off: git history is not scanned by this stage. That is an accepted limitation for
this project — the engineering documentation is the source of the false positives, and the
business risk being mitigated is secrets in application source that would be embedded in
container images.

### Pipeline Architecture

```
git push → GitLab
        │
        ▼
Stage: secret-scan (after validate)
        └── gitleaks-scan
              ├── gitleaks detect --source ./client/src --no-git --exit-code 1
              └── gitleaks detect --source ./api --no-git --exit-code 1
```

### Why `--no-git`

`gitleaks detect` without `--no-git` traverses git commit history. On this project, that
produces false positives from documentation files containing JWT examples. `--no-git`
scans the current filesystem content only — which is what will actually be included in the
Docker build context and compiled into images.

### Local Verification

```bash
gitleaks version
# 8.30.1

gitleaks detect --source ./client/src --no-git --exit-code 1
# INF scanned ~29980 bytes (29.98 KB) in 320ms
# INF no leaks found  (exit 0)

gitleaks detect --source ./api --no-git --exit-code 1
# INF scanned ~8318 bytes (8.32 KB) in 58.7ms
# INF no leaks found  (exit 0)
```

### GitLab Pipeline Verification

Pipeline `2800716629` on commit `beb60a5`. All 4 jobs on the runner confirmed:

| Job ID | Job Name | Status | Duration |
|---|---|---|---|
| 16176989886 | runner-verification | success | 5.68s |
| 16176989887 | validate-frontend | success | 4.69s |
| 16176989888 | validate-backend | success | 3.67s |
| 16176989889 | gitleaks-scan | success | 3.73s |

Evidence from `gitlab-runner.err.log`:
```
job=16176989889 job-status=success   (gitleaks-scan)
```

### Production Considerations

The current scan uses `--no-git` and scopes to `client/src` and `api`. A more comprehensive
production approach would:
1. Add a `.gitleaks.toml` configuration file to suppress known false positives selectively,
   allowing `--source .` to scan the entire repository
2. Use `gitleaks protect` as a pre-commit hook on developer machines as an earlier
   detection layer
3. Add a dedicated secrets baseline file to track reviewed false positives

These improvements are deferred to a future pipeline hardening iteration.

---

## Phase 8.6 Status: Complete

GitLeaks scanning confirmed passing on GitLab. Application source is free of detectable
secrets. Pipeline now has 3 stages: `verify`, `validate`, `secret-scan`.

**Next: Phase 8.7 — SonarQube Static Analysis**
Pre-condition: SonarQube must be running locally and `SONAR_TOKEN` must be added as a
masked GitLab CI variable.
