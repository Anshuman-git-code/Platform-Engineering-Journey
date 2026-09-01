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
| 9.3 Resource Requests | ⏳ |
| 9.4 Resource Limits | ⏳ |
| 9.5 Scaling | ⏳ |
| 9.6 Rolling Update | ⏳ |
| 9.7 Rollback | ⏳ |

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
