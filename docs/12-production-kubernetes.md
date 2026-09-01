# Phase 9 — Production Kubernetes Hardening

## Objective

Phase 8 deployed the application to Kubernetes using the simplest possible
configuration: deployments with no resource constraints, no health checks, and no
production-grade operational controls. The application runs — but it is not hardened
for production.

Phase 9 applies the production-oriented Kubernetes configuration that was deferred
throughout Phases 5–7. Every item in this phase was deliberately held back so that
the concepts would be introduced with a running application as context, not as
abstract theory.

---

## What Changes in Phase 9

| Sub-phase | Topic | What it adds |
|---|---|---|
| 9.1 | Readiness Probe | Pod signals when it is ready to receive traffic |
| 9.2 | Liveness Probe | Pod is restarted when it becomes unhealthy |
| 9.3 | Resource Requests | Scheduler places pods based on declared resource needs |
| 9.4 | Resource Limits | Cluster protects against runaway workloads |
| 9.5 | Scaling | Observe ReplicaSet behavior at different replica counts |
| 9.6 | Rolling Update (controlled) | Observe old/new ReplicaSet transition |
| 9.7 | Rollback Exercise | Deliberate bad image → diagnose → rollback |

---

## Engineering Problem

The Phase 8 deployment has three production-critical gaps:

**Gap 1 — No health checks.**
Kubernetes has no mechanism to distinguish a pod that is starting from a pod that is
ready to serve traffic. A backend pod that takes 10 seconds to initialize receives
traffic as soon as the container starts — before the Express server is listening.
Without a readiness probe, Kubernetes routes traffic to pods that cannot respond,
causing request failures during rollouts.

**Gap 2 — No resource constraints.**
A pod with no resource requests provides the scheduler with no placement information.
The scheduler places it anywhere, potentially on a node already under memory pressure.
A pod with no resource limits can consume all available memory on a node, starving
other pods including system components.

**Gap 3 — No operational observability during scaling.**
Phase 8.16 exercised rollback, but did not observe the ReplicaSet mechanics in detail.
Phase 9.5 and 9.6 explicitly observe what Kubernetes creates and destroys during
scaling and rolling updates — the actual ReplicaSet objects, not just the pod count.

---

## Phase 9 Roadmap

```
9.1 — Readiness Probe
    Add /health endpoint to backend
    Configure readinessProbe in backend deployment
    Verify: pod stays NotReady until backend is ready
    Verify: rolling update waits for readiness before routing traffic

9.2 — Liveness Probe
    Configure livenessProbe in backend deployment
    Verify: unhealthy container is restarted automatically

9.3 — Resource Requests
    Add requests: cpu + memory to backend, frontend, mysql
    Observe: scheduler behavior, node resource allocation

9.4 — Resource Limits
    Add limits: cpu + memory to backend, frontend, mysql
    Observe: OOMKilled behavior when limit is exceeded (optional exercise)

9.5 — Scaling
    Backend:  1 → 3 → 5 replicas
    Frontend: 3 → 5 → 10 replicas
    Observe: ReplicaSet objects, scheduler placement, service endpoints

9.6 — Rolling Update (controlled observation)
    Build backend:v2 locally (or tag existing image as v2)
    Deploy v2 → observe new ReplicaSet creation
    Watch old ReplicaSet scale down
    Verify revision history

9.7 — Rollback
    Deploy backend:v3-broken (non-existent tag)
    Observe ErrImagePull + stalled rollout
    Execute kubectl rollout undo
    Verify recovery
```

---

## Current Status

| Sub-phase | Status |
|---|---|
| 9.1 Readiness Probe | ✅ Complete |
| 9.2 Liveness Probe | ✅ Complete |
| 9.3 Resource Requests | ✅ Complete |
| 9.4 Resource Limits | ✅ Complete |
| 9.5 Scaling | ✅ Complete |
| 9.6 Rolling Update | ✅ Complete |
| 9.7 Rollback | ✅ Complete |

---

## Phase 9.1 — Readiness Probe

### Engineering Problem

Without a readiness probe, Kubernetes adds a pod to the Service endpoint list the
moment the container starts. The backend application takes a few seconds to initialize
— Express must bind to port 5000, load routes, and establish a MySQL connection. Any
traffic routed during this window receives connection refused or 500 errors.

The readiness probe solves this: a pod is only added to the Service's endpoint list
when the probe succeeds. Until then, no traffic is routed to it.

### Implementation

**Step 1 — Add `/health` endpoint to `api/app.js`:**

The endpoint checks both that Express is running AND that MySQL is reachable. An
endpoint that only returns 200 unconditionally tells Kubernetes the process is alive
but says nothing about whether the application can actually serve requests.

```javascript
app.get('/health', (req, res) => {
  db.query('SELECT 1', (err) => {
    if (err) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'unreachable',
        error: err.message
      });
    }
    res.status(200).json({
      status: 'healthy',
      database: 'connected'
    });
  });
});
```

`SELECT 1` is the standard lightweight MySQL connectivity check — it executes
instantly and returns a single row, confirming the connection is alive without
touching application data.

**Step 2 — Add `readinessProbe` to `Kubernetes/backend/deployment.yaml`:**

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 5000
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 3
```

**Field-by-field reasoning:**

| Field | Value | Reasoning |
|---|---|---|
| `path` | `/health` | The endpoint that confirms Express + MySQL are both ready |
| `port` | `5000` | Backend Express port |
| `initialDelaySeconds` | `15` | Backend needs ~5–10s to start, initialize MySQL connection, and seed admin. 15s is conservative to avoid probe failures during normal startup |
| `periodSeconds` | `10` | Check every 10s — fast enough to detect readiness quickly without excessive overhead |
| `failureThreshold` | `3` | 3 consecutive failures (30s) before marking NotReady — tolerates transient MySQL hiccups |

### Readiness Probe Data Flow

```
Pod scheduled
    │
    ├── Container starts → Node.js starts → Express binds port 5000
    │       └── MySQL connection established → admin seeded
    │
    ├── Kubernetes waits 15s (initialDelaySeconds)
    │
    ├── kubelet: GET http://<pod-ip>:5000/health
    │       ├── 200 → Pod enters Ready → Service adds pod to endpoints
    │       └── 503 → Probe fails → Pod stays NotReady → no traffic
    │
    └── kubelet: repeat every 10s
            ├── 200 → remains Ready
            └── 503 × 3 → Pod removed from Service endpoints (NotReady)
```

### Verification

```bash
# Apply updated manifest (probes are spec changes, not just image changes)
$ kubectl apply -f Kubernetes/backend/deployment.yaml -n prod
deployment.apps/backend configured

$ kubectl rollout status deployment/backend -n prod --timeout=60s
deployment "backend" successfully rolled out

# Confirm probes are configured on running pod
$ kubectl describe pod backend-58dc8667f6-mplwr -n prod | \
    grep -E "Liveness|Readiness|delay|period|threshold"

    Liveness:  http-get http://:5000/health delay=30s timeout=1s period=20s #failure=3
    Readiness: http-get http://:5000/health delay=15s timeout=1s period=10s #failure=3

# Confirm /health endpoint returns correct response
$ kubectl port-forward service/backend 5002:5000 -n prod &
$ curl http://localhost:5002/health

{"status":"healthy","database":"connected"}
```

No probe failure events in `kubectl describe pod` — the pod passed readiness on first
check, confirming Express and MySQL were both ready within the 15s initial delay.

---

## Phase 9.2 — Liveness Probe

### Engineering Problem

A running pod may enter a broken state: a deadlock in the application, an exhausted
connection pool, or a goroutine leak causing the event loop to stop processing requests.
The container process is still running (it hasn't crashed), so Kubernetes won't restart
it automatically. Without a liveness probe, a broken pod stays in `Running` state
indefinitely, silently failing every request.

The liveness probe solves this: if the probe fails a defined number of times, Kubernetes
kills the container and restarts it automatically.

### Implementation

Added to the same deployment, alongside the readiness probe:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 5000
  initialDelaySeconds: 30
  periodSeconds: 20
  failureThreshold: 3
```

**Why `initialDelaySeconds: 30` (higher than readiness):**

The liveness probe must never fire during normal startup — if it did, it would restart
the container before it had a chance to become healthy, creating an infinite restart loop.
The readiness probe uses `initialDelaySeconds: 15`. The liveness probe uses `30` — well
past the point where readiness should already have succeeded.

**Why the same `/health` endpoint:**

The health endpoint checks both Express responsiveness and MySQL connectivity. These
are the two failure modes that warrant a restart:
- Express stops responding → restart
- MySQL connection permanently broken → restart (new container = new connection attempt)

A liveness probe that only checks `200` from a process-health endpoint would not catch
a broken MySQL connection. Using `/health` with the `SELECT 1` check covers both cases.

### Liveness vs Readiness — Comparison

```
Readiness probe:
    Purpose: "Is this pod ready to receive traffic?"
    On failure: Pod removed from Service endpoints (no traffic)
    Container: NOT restarted
    Use case: Slow startup, temporary unavailability

Liveness probe:
    Purpose: "Is this pod still functioning?"
    On failure: Container KILLED and RESTARTED
    Container: Restarted by kubelet
    Use case: Deadlock, broken state, unrecoverable error
```

Both probes use the same `/health` endpoint but serve different control loops in
Kubernetes. The readiness probe controls traffic routing. The liveness probe controls
container lifecycle.

### Verified Configuration

```bash
$ kubectl describe pod backend-58dc8667f6-mplwr -n prod | \
    grep -E "Liveness|Readiness|delay|period|threshold"

    Liveness:  http-get http://:5000/health delay=30s timeout=1s period=20s #success=1 #failure=3
    Readiness: http-get http://:5000/health delay=15s timeout=1s period=10s #success=1 #failure=3
```

Both probes confirmed active on running pod. No restart events in pod description.

### Debugging Reference

```bash
# Check probe configuration on a running pod
kubectl describe pod <pod-name> -n prod | grep -E "Liveness|Readiness|delay|period"

# Watch probe-triggered restarts in real time
kubectl get pods -n prod -w

# Check restart count and reason
kubectl get pods -n prod
# RESTARTS column shows count; non-zero = liveness triggered restart

# Get detailed restart history
kubectl describe pod <pod-name> -n prod | grep -A5 "Last State\|Reason"

# Test health endpoint manually
kubectl port-forward service/backend 5002:5000 -n prod &
curl http://localhost:5002/health
# Healthy: {"status":"healthy","database":"connected"}
# Unhealthy: {"status":"unhealthy","database":"unreachable","error":"..."}
```

---

## Phase 9.1 + 9.2 Status: Complete

Readiness and liveness probes confirmed active on backend pod (commit `b01f52b`).
Health endpoint verified returning `{"status":"healthy","database":"connected"}`.
No probe failures during normal startup.

**Next: Phase 9.3 — Resource Requests**

---

## Phase 9.3 — Resource Requests

### Engineering Problem

Without resource requests, the Kubernetes scheduler has no information about what a pod
needs. It places pods arbitrarily — potentially on a node that is already under memory
pressure. When that node runs out of memory, Kubernetes evicts pods to reclaim resources.
Without requests, the scheduler cannot predict or prevent this.

Resource requests answer a specific question: "What is the minimum this pod needs to
function?" The scheduler uses this to make placement decisions — it only assigns a pod
to a node that has at least the requested amount available.

### Implementation

**Backend (`api/`) — Node.js + Express:**
```yaml
resources:
  requests:
    cpu: "100m"      # 0.1 CPU cores — adequate for idle Express + auth operations
    memory: "128Mi"  # Node.js baseline + bcrypt + mysql2 driver
```

**Frontend (`client/`) — Nginx serving static files:**
```yaml
resources:
  requests:
    cpu: "50m"       # Nginx is nearly idle — static file serving is IO-bound
    memory: "32Mi"   # nginx:alpine with ~91KB of static content
```

**MySQL (`mysql/`) — MySQL 8:**
```yaml
resources:
  requests:
    cpu: "100m"      # MySQL is IO-bound for this workload, not CPU-bound
    memory: "256Mi"  # InnoDB buffer pool requires meaningful memory
```

### How the Scheduler Uses Requests

```
kubectl apply → Kubernetes API → Scheduler
                                    │
                                    ├── Finds nodes with enough allocatable capacity
                                    │     Node.allocatable.cpu >= sum(pod.requests.cpu)
                                    │     Node.allocatable.memory >= sum(pod.requests.memory)
                                    │
                                    └── Places pod on qualifying node
```

In Minikube (single node), placement is always the same node. The value of requests
becomes visible when scaling: 10 frontend replicas × 32Mi = 320Mi reserved — the
scheduler won't place replica 11 if the node has less than 352Mi remaining.

### Verification Commands

```bash
# Confirm requests are set on running pods
kubectl describe pod -n prod -l app=backend | grep -A4 "Requests:"
# Output:
#   Requests:
#     cpu:     100m
#     memory:  128Mi

# View node resource allocation
kubectl describe node minikube | grep -A8 "Allocated resources"
# Output shows sum of all pod requests vs node capacity

# Check how much is allocated vs available
kubectl get node minikube -o jsonpath='{.status.allocatable}' | python3 -m json.tool
```

---

## Phase 9.4 — Resource Limits

### Engineering Problem

Resource requests guarantee placement. Without limits, a container can consume all
available resources on a node — starving other pods, including system components like
etcd and the API server. A memory leak in the Node.js backend would grow unchecked
until the node OOM-kills random processes.

Resource limits answer a different question: "What is the maximum this pod is allowed
to consume?" They protect the cluster from runaway workloads.

### How Limits Work

```
CPU limit:    Container CPU usage > limit → THROTTLED (slowed, not killed)
Memory limit: Container memory usage > limit → OOMKilled (container killed + restarted)
```

CPU throttling is invisible to the application — it just runs slower. Memory killing
is abrupt — the container dies and restarts. This is intentional: unbounded memory
growth is a sign of a bug (leak), and the correct response is to restart the container
and alert, not let it consume the whole node.

### Values Chosen

| Container | CPU limit | Memory limit | Reasoning |
|---|---|---|---|
| backend | `500m` | `256Mi` | 5× CPU request headroom; 2× memory — bcrypt + JWT under load |
| frontend | `200m` | `64Mi` | Nginx rarely needs burst CPU; 2× memory for Nginx workers |
| mysql | `500m` | `512Mi` | InnoDB cache growth; 2× request allows buffer pool to expand |

### Real Failure Observed — Probe 503 During Restart

When resource limits were first applied, a rolling update triggered. During the
transition, the old backend pod's readiness probe reported:

```
Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 503
Warning  Unhealthy  Liveness probe failed: HTTP probe failed with statuscode: 503
```

**Root cause:** The 503 came from the `/health` endpoint's `SELECT 1` query failing
because MySQL was briefly unreachable during the pod restart cycle. This is correct
probe behavior — the endpoint detected a real unhealthy state and reported it.

**What Kubernetes did:** The liveness probe fired after 3 failures → container restarted.
After restart, MySQL reconnected → health endpoint returned 200 → pod became Ready.

**Engineering lesson:** The 503s during startup are not probe bugs — they are the probes
working exactly as designed. A well-implemented health endpoint that checks real
dependencies will naturally report unhealthy during startup transitions. This is why
`initialDelaySeconds` matters: setting it too low causes unnecessary restarts.

### Verification

```bash
# Confirm limits on running pod
kubectl describe pod -n prod -l app=backend | grep -A4 "Limits:"
# Output:
#   Limits:
#     cpu:     500m
#     memory:  256Mi

# All pods running after limit application
kubectl get pods -n prod
# NAME                       READY   STATUS    RESTARTS
# backend-775999bd58-xpzpk   1/1     Running   1 (2m ago)
# frontend-c8dd876dd-*       1/1     Running   0
# mysql-7487488b4f-kq98l     1/1     Running   0

# Health confirmed after stabilization
curl http://localhost:5002/health
# {"status":"healthy","database":"connected"}
```

### Debugging Reference

```bash
# Check if a pod was OOMKilled
kubectl describe pod <name> -n prod | grep -A3 "Last State:"
# OOMKilled shows as: Reason: OOMKilled

# Check current resource usage (requires metrics-server)
kubectl top pods -n prod
# Install metrics-server in Minikube: minikube addons enable metrics-server

# View all resource requests/limits in namespace
kubectl get pods -n prod -o custom-columns=\
"NAME:.metadata.name,\
CPU_REQ:.spec.containers[0].resources.requests.cpu,\
MEM_REQ:.spec.containers[0].resources.requests.memory,\
CPU_LIM:.spec.containers[0].resources.limits.cpu,\
MEM_LIM:.spec.containers[0].resources.limits.memory"
```

---

## Phase 9.3 + 9.4 Status: Complete

Resource requests and limits applied to all three deployments (backend, frontend, mysql).
All pods confirmed running. Probe behavior during rolling update documented.
Health endpoint verified returning `{"status":"healthy","database":"connected"}` post-restart.

**Commit:** `ec0d8df`
**Next: Phase 9.5 — Scaling**

---

## Phase 9.5 — Scaling

### Engineering Problem

Scaling is not just changing a number. The exercise is about understanding what
Kubernetes actually creates and modifies at each layer during a scale event — and
what the Service's endpoint list looks like at each step.

### Pre-Scaling State

```bash
$ kubectl get replicasets -n prod -l app=backend
NAME                 DESIRED   CURRENT   READY   AGE
backend-775999bd58   1         1         1       9m

$ kubectl get pods -n prod -l app=backend
NAME                       READY   STATUS    RESTARTS
backend-775999bd58-xpzpk   1/1     Running   1
```

One ReplicaSet. One pod. Service endpoint: 1 IP.

### Backend: 1 → 3 → 5

**Scale to 3:**
```bash
$ kubectl scale deployment/backend --replicas=3 -n prod
deployment.apps/backend scaled

$ kubectl get pods -n prod -l app=backend
NAME                       READY   STATUS              RESTARTS
backend-775999bd58-mt7wn   0/1     ContainerCreating   0          ← new
backend-775999bd58-pmd8g   0/1     ContainerCreating   0          ← new
backend-775999bd58-xpzpk   1/1     Running             1          ← existing
```

**Key observation:** All three pods share the SAME ReplicaSet (`775999bd58`). Scaling
does not create a new ReplicaSet — scaling changes the desired count on the existing one.
A new ReplicaSet is only created during a rolling update (image or spec change).

**Scale to 5 and observe Service endpoints:**
```bash
$ kubectl scale deployment/backend --replicas=5 -n prod

$ kubectl get endpoints backend -n prod
NAME      ENDPOINTS
backend   10.244.0.30:5000,10.244.0.35:5000,10.244.0.36:5000 + 1 more...
```

The Service endpoint list grows automatically as new pods pass readiness. The
`+ 1 more...` indicates 4 endpoints (kubectl truncates at 3). Once all 5 pods pass
the readiness probe, all 5 IPs appear in the endpoint list and the Service load-balances
across all of them.

### Frontend: 3 → 5 → 10

```bash
$ kubectl scale deployment/frontend --replicas=5 -n prod
$ kubectl scale deployment/frontend --replicas=10 -n prod

$ kubectl get pods -n prod -l app=frontend
frontend-c8dd876dd-*   1/1   Running   (10 pods, all same ReplicaSet)

$ kubectl get endpoints frontend -n prod
NAME       ENDPOINTS
frontend   10.244.0.31:80,10.244.0.33:80,10.244.0.34:80 + 7 more...
```

10 endpoints. All serving traffic through the Service.

### ReplicaSet Observations

```bash
$ kubectl get replicasets -n prod -l app=frontend
NAME                  DESIRED   CURRENT   READY
frontend-c8dd876dd    10        10        10    ← current, active
frontend-6b86db8676   0         0         0     ← old (Phase 8 deploys)
frontend-74c5d4676    0         0         0     ← old
frontend-7f8cd65557   0         0         0     ← old
...
```

Old ReplicaSets remain in the namespace with DESIRED=0. Kubernetes retains them for
rollback purposes — `kubectl rollout undo` can reactivate any of them. They are
cleaned up automatically when they exceed `revisionHistoryLimit` (default: 10).

### Scaling Mechanics — Data Flow

```
kubectl scale deployment/backend --replicas=5 -n prod
    │
    ▼
Kubernetes API updates Deployment.spec.replicas = 5
    │
    ▼
ReplicaSet controller observes: desired=5, current=1
    │
    ▼
Creates 4 new Pod objects (same ReplicaSet, same spec)
    │
    ▼
Scheduler assigns pods to nodes (only node: minikube)
    │
    ▼
kubelet pulls image (cached → fast), starts containers
    │
    ▼
Readiness probe: GET /health → 200
    │
    ▼
Endpoints controller adds pod IP to Service endpoint list
    │
    ▼
All 5 pods receive traffic via kube-proxy load balancing
```

### Scale Down — Scale Back to Production Values

```bash
$ kubectl scale deployment/backend --replicas=1 -n prod
$ kubectl scale deployment/frontend --replicas=3 -n prod
```

Scale-down is immediate for the Deployment object. Old pods enter `Terminating`
state — kubelet sends SIGTERM, waits for `terminationGracePeriodSeconds` (default 30s),
then SIGKILL. The Service endpoint controller removes the pod IP from the endpoint list
as soon as the pod enters Terminating — no new requests are routed to it.

### Debugging Reference

```bash
# Scale a deployment
kubectl scale deployment/<name> --replicas=<n> -n prod

# Watch scaling in real time
kubectl get pods -n prod -w

# Check current replica count
kubectl get deployments -n prod

# Inspect ReplicaSets (shows history)
kubectl get replicasets -n prod

# Check Service endpoints (IPs of Ready pods)
kubectl get endpoints -n prod

# Describe endpoint object for full IP list
kubectl describe endpoints backend -n prod
```

---

## Phase 9.5 Status: Complete

Backend scaled 1→3→5, frontend scaled 3→5→10. ReplicaSet behavior confirmed —
scaling reuses existing ReplicaSet, does not create new one. Service endpoints
grow/shrink automatically as pods pass/fail readiness. Scaled back to baseline
(backend: 1, frontend: 3).

**Next: Phase 9.6 — Controlled Rolling Update (observe old/new ReplicaSet transition)**

---

## Phase 9.6 — Controlled Rolling Update

### Engineering Problem

Phase 8.16 exercised rollback from a failure. Phase 9.6 observes the rolling update
mechanics in detail — specifically what Kubernetes creates and destroys at the
ReplicaSet level during a planned update. This is what happens on every successful
`kubectl set image` or pipeline deploy.

### The Change — backend v2.0.0

Added `version` field to the `/health` response in `api/app.js`:

```javascript
res.status(200).json({
  status: 'healthy',
  database: 'connected',
  version: '2.0.0'     // ← new in v2
});
```

Committed as `0c0feac`, pushed to Docker Hub as `anshuman04/backend:0c0feac`.
Pipeline `deploy-to-minikube` job executed `kubectl set image` with the new tag.

### The Rolling Update — `kubectl rollout status` Timeline

From the GitLab CI job log (commit `0c0feac`):

```
13:22:34  Waiting: 1 out of 3 new replicas have been updated...
13:23:09  Waiting: 1 out of 3 new replicas have been updated...   ← readiness probe wait
13:23:09  Waiting: 2 out of 3 new replicas have been updated...   ← pod 1 ready
13:23:37  Waiting: 2 out of 3 new replicas have been updated...   ← readiness probe wait
13:23:37  Waiting: 1 old replicas are pending termination...      ← pod 2 ready
13:24:03  Waiting: 1 old replicas are pending termination...      ← waiting for graceful stop
13:24:03  deployment "backend" successfully rolled out             ← complete (~102s total)
```

The 35-second gaps between steps are the readiness probe waiting period —
`initialDelaySeconds: 15` + up to 3 × `periodSeconds: 10` per new pod before the
probe passes and the old pod is terminated.

### ReplicaSet Transition — Live Watch Output

The core observation of this phase. Watched via `kubectl get replicasets -n prod -l app=backend -w`:

```
NAME                 DESIRED   CURRENT   READY    ← State
backend-775999bd58   3         3         3        ← OLD RS — before update starts
backend-7d9f64c858   1         1         0   20s  ← NEW RS created, 1st pod starting
backend-7d9f64c858   1         1         1   36s  ← 1st new pod Ready
backend-775999bd58   2         3         3   3h35m ← OLD RS desired reduced to 2
backend-7d9f64c858   2         1         1   36s  ← NEW RS scaled to 2
backend-775999bd58   2         2         2   3h35m ← OLD RS at 2 ready
backend-7d9f64c858   2         2         2   63s  ← 2nd new pod Ready
backend-775999bd58   1         2         2   3h35m ← OLD RS desired reduced to 1
backend-7d9f64c858   3         2         2   64s  ← NEW RS scaled to 3
backend-7d9f64c858   3         3         2   64s  ← 3rd pod starting
backend-7d9f64c858   3         3         3   90s  ← ALL 3 new pods Ready
backend-775999bd58   0         1         1   3h36m ← OLD RS draining last pod
backend-775999bd58   0         0         0   3h36m ← OLD RS at 0 — update complete
```

**What this shows:**

Two ReplicaSets coexist during the transition. Neither is deleted. The old RS scales down
one pod at a time only after a new pod passes readiness. This is the `maxUnavailable: 0`
rolling strategy — at no point are there fewer than 3 Ready backend pods.

```
Time →
                  RS 775999bd58 (OLD)     RS 7d9f64c858 (NEW)
Start:            DESIRED=3              DESIRED=0
Step 1:           DESIRED=3              DESIRED=1, pod starting
Step 2 (ready):   DESIRED=2              DESIRED=2
Step 3 (ready):   DESIRED=1              DESIRED=3
Complete:         DESIRED=0              DESIRED=3
```

### Verification — New Version Running

```bash
$ curl http://localhost:5002/health
{"status":"healthy","database":"connected","version":"2.0.0"}
```

`version: 2.0.0` confirms the new backend code is running. The old pods that returned
`{"status":"healthy","database":"connected"}` (no version field) are gone.

### Pod State at Completion

```
backend-775999bd58-6zwf7   1/1   Terminating   ← old pod draining
backend-775999bd58-xpzpk   1/1   Terminating   ← old pod draining
backend-7d9f64c858-9gbb9   1/1   Running       ← new, v2.0.0
backend-7d9f64c858-frs9k   1/1   Running       ← new, v2.0.0
backend-7d9f64c858-vk9tx   1/1   Running       ← new, v2.0.0
```

### Debugging Reference

```bash
# Watch rolling update live (ReplicaSet level)
kubectl get replicasets -n prod -l app=backend -w

# Watch pod-level transitions
kubectl get pods -n prod -l app=backend -w

# Check rollout progress
kubectl rollout status deployment/backend -n prod

# View rollout history
kubectl rollout history deployment/backend -n prod

# Verify new version in response
kubectl port-forward service/backend 5002:5000 -n prod &
curl http://localhost:5002/health
```

---

## Phase 9.6 Status: Complete

Rolling update confirmed with live ReplicaSet watch. Two ReplicaSets coexisted during
transition. Zero downtime — old RS scaled down one pod at a time only after new pods
passed readiness. New version `2.0.0` confirmed running.

**Next: Phase 9.7 — Rollback Exercise**

---

## Phase 9.7 — Rollback Exercise

### Engineering Problem

The same as Phase 8.16, but now with production hardening in place — probes, resource
limits, and multiple replicas. The question is: does the rollback mechanism still work
correctly when the deployment has readiness probes? And does the rolling update safety
guarantee hold — no downtime even when a new image fails to pull?

### Pre-State

Current: revision 11, image `anshuman04/backend:0c0feacc` (v2.0.0), 3 replicas running.

```bash
$ kubectl rollout history deployment/backend -n prod | tail -3
10        <none>
11        <none>    ← current: anshuman04/backend:0c0feacc
```

### Step 1 — Inject Bad Image

```bash
$ kubectl set image deployment/backend backend=anshuman04/backend:v3-broken -n prod
deployment.apps/backend image updated
```

### Step 2 — Observe Stall

```bash
$ kubectl get pods -n prod -l app=backend   # 25s after inject
NAME                       READY   STATUS             RESTARTS
backend-7d9f64c858-9gbb9   1/1     Running            0          ← OLD, v2.0.0
backend-7d9f64c858-frs9k   1/1     Running            0          ← OLD, v2.0.0
backend-7d9f64c858-vk9tx   1/1     Running            0          ← OLD, v2.0.0
backend-84cdbc9f94-ptr6v   0/1     ImagePullBackOff   0          ← NEW, broken

$ kubectl describe pod backend-84cdbc9f94-ptr6v -n prod | grep -A6 "Events:"
Warning  Failed  kubelet  Failed to pull image "anshuman04/backend:v3-broken":
                 manifest for anshuman04/backend:v3-broken not found: manifest unknown
Warning  Failed  kubelet  Error: ErrImagePull
Warning  Failed  kubelet  Error: ImagePullBackOff

$ kubectl rollout status deployment/backend -n prod --timeout=10s
Waiting: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition   ← stalled, as expected
```

Rolling update stalled. Old pods keep serving traffic.

### Step 3 — Verify Zero Downtime During Stall

```bash
$ curl http://localhost:5002/health
{"status":"healthy","database":"connected","version":"2.0.0"}
```

HTTP 200 confirmed while bad pod is in `ImagePullBackOff`. The readiness probe never
passed on the broken pod — it was never added to the Service endpoint list. Traffic
continued routing to the three old pods exclusively.

**This is proof that readiness probes + rolling updates together provide zero-downtime
protection against bad image deployments.**

### Step 4 — Roll Back

```bash
$ kubectl rollout undo deployment/backend -n prod
deployment.apps/backend rolled back

$ kubectl rollout status deployment/backend -n prod --timeout=60s
Waiting for deployment spec update to be observed...
Waiting: 1 old replicas are pending termination...
deployment "backend" successfully rolled out
```

### Step 5 — Verify Recovery

```bash
$ kubectl get pods -n prod -l app=backend
NAME                       READY   STATUS    RESTARTS
backend-7d9f64c858-9gbb9   1/1     Running   0    ← same ReplicaSet as before bad deploy
backend-7d9f64c858-frs9k   1/1     Running   0
backend-7d9f64c858-vk9tx   1/1     Running   0

$ curl http://localhost:5002/health
{"status":"healthy","database":"connected","version":"2.0.0"}

$ kubectl rollout history deployment/backend -n prod | tail -3
12        <none>    ← bad deploy (v3-broken)
13        <none>    ← rollback (restored RS 7d9f64c858 as new revision)
```

### What Changed vs Phase 8.16

In Phase 8.16 the deployment had no readiness probes. The broken pod went to
`ImagePullBackOff` but the deployment eventually timed out differently. In Phase 9.7,
the readiness probe configuration means the broken pod is definitively never added to
the endpoint list — the protection is explicit and guaranteed, not accidental.

### Rollback with Readiness Probes — Data Flow

```
kubectl rollout undo deployment/backend
    │
    ▼
Kubernetes activates previous ReplicaSet (7d9f64c858)
    │
    ├── New RS desired = 3 (was 0, reactivated)
    ├── Bad RS desired = 0 (84cdbc9f94 — the broken one)
    │
    ▼
Bad pod (84cdbc9f94-ptr6v) terminated immediately
    │
    ▼
Old pods (7d9f64c858-*) already running — no new pull needed
    │
    ▼
Readiness probe passes (already healthy)
    │
    ▼
Deployment reports: "successfully rolled out"
```

Since the previous ReplicaSet's pods were still running (they never got terminated
because the bad pod never passed readiness), the rollback is near-instant.

### Debugging Reference

```bash
# Check rollout history
kubectl rollout history deployment/backend -n prod

# Check specific revision image
kubectl rollout history deployment/backend -n prod --revision=<n>

# Roll back to previous revision
kubectl rollout undo deployment/backend -n prod

# Roll back to specific revision
kubectl rollout undo deployment/backend -n prod --to-revision=<n>

# Confirm active image after rollback
kubectl describe pod -n prod -l app=backend | grep Image:
```

---

## Phase 9.7 Status: Complete

Rollback confirmed working with readiness probes active. Zero downtime during stall
verified — old pods served traffic throughout the bad deploy. `kubectl rollout undo`
succeeded instantly since old ReplicaSet pods were never terminated.

---

## Phase 9 — ALL SUB-PHASES COMPLETE

```
9.1 ✅ Readiness Probe — /health endpoint, pod waits for MySQL before accepting traffic
9.2 ✅ Liveness Probe  — container restarted if /health fails 3 times
9.3 ✅ Resource Requests — scheduler places pods based on declared minimums
9.4 ✅ Resource Limits  — cluster protected against runaway memory/CPU
9.5 ✅ Scaling         — backend 1→3→5, frontend 3→5→10, ReplicaSet mechanics observed
9.6 ✅ Rolling Update  — old/new ReplicaSet coexistence confirmed, live watch output
9.7 ✅ Rollback        — bad image → stall → zero downtime → rollback → recovery
```

**Next Phase: Phase 10 — Helm**
