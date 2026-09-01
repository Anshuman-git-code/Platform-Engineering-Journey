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
| 9.1 Readiness Probe | ⏳ |
| 9.2 Liveness Probe | ⏳ |
| 9.3 Resource Requests | ⏳ |
| 9.4 Resource Limits | ⏳ |
| 9.5 Scaling | ⏳ |
| 9.6 Rolling Update | ⏳ |
| 9.7 Rollback | ⏳ |
