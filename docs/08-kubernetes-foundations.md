# Phase 5 — Kubernetes Foundations

## Objective

Phase 5 applies the same engineering methodology used throughout Phases 1–4. No YAML is written until the architecture is fully understood. Every component is introduced by first establishing the problem it solves.

The phases before this one built expertise in individual containers and multi-container orchestration on a single machine. Phase 5 addresses the next scale: operating containerized applications across many machines, automatically, reliably, and at production load.

---

## Updated Project Roadmap

```
Phase 0   Engineering Investigation          ✅
Phase 1   Docker Foundations                 ✅
Phase 2   Backend Containerization           ✅
Phase 3   Frontend Containerization          ✅
Phase 4   Docker Compose                     ✅
──────────────────────────────────────────────
Phase 5   Kubernetes Fundamentals            ← current
Phase 6   Backend on Kubernetes
Phase 7   Frontend on Kubernetes
Phase 8   Complete CI/CD Pipeline
Future    Terraform / AWS EKS / Monitoring /
          Ingress / Helm / HPA
```

The project repository contains Kubernetes manifests in `K8s/` — `backend.yaml`, `frontend.yaml`, `mysql.yaml`, `sc.yaml` — along with a Jenkins pipeline and production deployment guides. These will be analyzed in Phase 6 and 7, following the same pattern used for Dockerfiles and `docker-compose.yaml`.

---

## Why Kubernetes Exists

### The Docker Compose Scaling Problem

Docker Compose runs an entire three-tier application with one command on one machine. For a development environment or a small deployment, this is sufficient. In production at scale, it breaks down in four specific ways.

Consider what happens when the application grows from 10 users to 10 million:

```
Development (Docker Compose):          Production Reality:

docker compose up                      Frontend    × 5
                                       Backend     × 20
Frontend × 1                           Worker      × 15
Backend  × 1            →              Redis       × 3
MySQL    × 1                           MySQL Primary + Replicas
                                       RabbitMQ
                                       Prometheus / Grafana
                                       Nginx
                                       ≈ 50+ containers
```

Fifty containers on one machine is still manageable. Google's Gmail, YouTube, Maps, Search, and Drive collectively run hundreds of thousands of containers across tens of thousands of servers. At that scale, four fundamental problems emerge that Docker Compose cannot address:

**Problem 1 — Scheduling**
A new backend container needs to start. Which server should run it?

```
Server A: CPU 10%,  RAM 20%
Server B: CPU 95%,  RAM 90%
Server C: CPU 30%,  RAM 45%
```

Docker does not know cluster-wide resource availability. It manages only its own machine. Without a system that sees all servers simultaneously, operators either manually decide placement or accept random distribution.

**Problem 2 — Self-Healing**
A server suffers a power failure. 120 containers vanish.

```
Server 17
    │
    ▼ Power failure
    │
120 Containers gone
```

Docker can restart containers on the same machine, but if the machine is dead, Docker on that machine is also dead. Nothing restarts those containers on a different server.

**Problem 3 — Scaling**
Traffic doubles. The backend needs to scale from 20 containers to 60.

```
20 containers → need 60 containers
```

Which servers have capacity? Who creates the extra 40? How are they distributed? Docker Compose has no mechanism for scaling across multiple machines.

**Problem 4 — Rolling Updates**
A new version needs to be deployed without downtime.

```
backend:v1 → backend:v2
```

Stopping all 100 containers and starting new ones produces downtime. A rolling update — start one new container, verify, stop one old container, repeat — requires a system that understands the entire fleet and can orchestrate the sequence. Docker Compose does not do this.

### The Engineering History

```
Monolithic Applications
        │
        ▼
Need independent deployment per component
        │
        ▼
Microservices — many independently deployable services
        │
        ▼
Need to operate thousands of services reliably
        │
        ▼
Google builds Borg (internal, 2003)
        │
        ▼
Google releases Kubernetes as open source (2014)
```

Microservices created the operational problem. Kubernetes is the solution to that problem. Docker solved containerization — how to package and run one container. Kubernetes solves orchestration — how to operate hundreds of thousands of containers automatically across a fleet of machines.

### The Four Problems Kubernetes Solves

Every component in Kubernetes exists to solve one or more of these four problems:

| Problem | Description |
|---|---|
| **Scheduling** | Decide which machine should run each container |
| **Self-Healing** | Detect failures and restart containers automatically |
| **Scaling** | Increase or decrease the number of running containers based on demand |
| **Service Discovery & Load Balancing** | Route traffic to healthy container instances without callers knowing which specific instance handles each request |

The mental shift from Docker to Kubernetes:

```
Docker thinks:     Container
Docker Compose:    Application
Kubernetes thinks: Entire Data Center
```

---

## What Is a Kubernetes Cluster

### The Multi-Machine Problem

A single server has finite CPU, RAM, and disk. When the application outgrows one machine, the workload must spread across many:

```
One server (Docker Compose):
┌────────────────────────┐
│  Linux Server          │
│  Frontend              │
│  Backend               │
│  MySQL                 │
└────────────────────────┘

Multiple servers (pre-Kubernetes):
Server A        Server B        Server C
Frontend        Backend         Redis
Backend         MySQL
```

Managing individual servers produces a new problem: which container is on which server? When Server B dies, who restarts MySQL? Which server has capacity for the next backend deployment?

### The Kubernetes Answer

Instead of managing 500 individual servers, Kubernetes treats them as one logical system:

```
                    Kubernetes Cluster
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   You say: "Run 3 backend containers"                    │
│   Kubernetes decides: which servers get them             │
│   Kubernetes monitors: are they running?                 │
│   Kubernetes repairs: restarts failed containers         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

The analogy is cloud storage. A file uploaded to Google Drive is stored on some physical hard drive in some data center. The user does not know which one. The user does not need to know. Google's infrastructure manages placement, replication, and failure recovery transparently. Kubernetes does the same for containers.

**Definition:** A Kubernetes cluster is a group of Linux machines managed together as one logical system.

---

## Cluster Architecture

A Kubernetes cluster has two kinds of machines with fundamentally different roles:

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                   │
│                                                         │
│   ┌──────────────────────────────────────┐              │
│   │           Control Plane              │              │
│   │  (brain — makes decisions)           │              │
│   │                                      │              │
│   │  API Server   etcd   Scheduler       │              │
│   │  Controller Manager                  │              │
│   └──────────────────────────────────────┘              │
│                        │                                │
│          ──────────────────────────────                 │
│          │              │              │                │
│   ┌──────┴──────┐ ┌─────┴──────┐ ┌────┴──────┐        │
│   │  Worker 1   │ │  Worker 2  │ │  Worker 3 │        │
│   │  kubelet    │ │  kubelet   │ │  kubelet  │        │
│   │  containerd │ │  containerd│ │  containerd│       │
│   │  Pods       │ │  Pods      │ │  Pods     │        │
│   └─────────────┘ └────────────┘ └───────────┘        │
└─────────────────────────────────────────────────────────┘
```

**Control Plane** — the brain. Makes all cluster-wide decisions. Never runs application workloads. Manages the state of the cluster.

**Worker Nodes** — the muscle. Execute workloads (run containers). Do not make cluster-wide decisions. Follow instructions from the Control Plane.

The company analogy:

```
Control Plane  →  Management (decides strategy, assigns work)
Worker Node    →  Employees  (execute the assigned work)
```

### Why the Control Plane Must Be Separate

If every Worker Node made its own scheduling decisions independently, four failures would occur:

1. **Split-brain:** Multiple nodes might claim the same container, or all assume another node is handling it — leaving the container unscheduled.

2. **Resource blindness:** A node only knows its own CPU and RAM. It cannot see that another node is already at 95% utilization. Containers would be placed on overloaded machines while others sit idle.

3. **N×N communication:** For nodes to make informed decisions, each would need to constantly synchronize state with every other node. In a 500-node cluster, this produces 249,750 communication paths — consuming all available bandwidth for coordination instead of actual work.

4. **Global features impossible:** Rolling updates, anti-affinity rules, global resource quotas — none of these can be coordinated without a single authoritative source of cluster state.

The Control Plane exists as a single decision-making authority. Workers are intentionally kept simple — they receive instructions and execute them.

---

## The Control Plane Components

The Control Plane is not one monolithic process. It is a set of specialized processes running on a dedicated machine, each with a distinct responsibility:

```
Control Plane Machine
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ┌───────────────┐    ┌─────────────────────────┐   │
│   │  API Server   │◄──►│         etcd            │   │
│   │               │    │  (cluster memory)       │   │
│   └───────┬───────┘    └─────────────────────────┘   │
│           │                                          │
│   ┌───────▼───────┐    ┌─────────────────────────┐   │
│   │   Scheduler   │    │  Controller Manager     │   │
│   │               │    │                         │   │
│   └───────────────┘    └─────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## API Server

### Engineering Problem

Every kubectl command, every internal component communication, every node status report — all of these need a single, authoritative entry point. Without one, different parts of the system would have different views of the cluster state.

### What the API Server Is

The API Server is the front door of the Kubernetes cluster. Every interaction with the cluster passes through it — from external users (kubectl), from internal components (Scheduler, Controller Manager), and from every Worker Node (kubelet status reports).

```
External:                    Internal:
kubectl apply    ──────┐     Scheduler    ──────┐
kubectl get pods ──────┤     Controller   ──────┤    ┌─────────────┐
kubectl logs     ──────┤     kubelet      ──────┤───►│  API Server │
kubectl delete   ──────┘     Manager      ──────┘    └─────────────┘
```

The company analogy: the API Server is the reception desk. No one walks directly into HR or Finance. Everyone goes through reception first.

The engineering analogy from this project:

```
Browser  →  Express (backend API)  →  database
kubectl  →  API Server             →  etcd
```

The Express backend is the front door of the application. The API Server is the front door of the cluster.

### Why Not Let kubectl Talk Directly to Workers

If kubectl communicated directly with Worker Nodes:

```
Engineer A:  kubectl → Worker 1  (different state)
Engineer B:  kubectl → Worker 2  (different state)
Engineer C:  kubectl → Worker 3  (different state)
```

No component would have a complete picture of the cluster. Race conditions would occur. Inconsistent state would accumulate. Rolling updates, global quotas, and anti-affinity rules would be impossible to coordinate.

Instead:

```
Engineer A:  kubectl → API Server → consistent cluster state
Engineer B:  kubectl → API Server → consistent cluster state
Engineer C:  kubectl → API Server → consistent cluster state
```

Single source of communication. Single point of truth.

### What the API Server Does NOT Do

The API Server does not schedule containers. It does not start containers. It does not monitor whether containers are healthy. It validates requests, authenticates and authorizes callers, and writes or reads state from etcd. That is its entire responsibility.

---

## etcd

### Engineering Problem

The API Server processes requests. Where does it store the results? If cluster state were held in the API Server's memory, a restart would erase all knowledge of every Deployment, Service, Pod, and ConfigMap in the cluster.

### What etcd Is

etcd is a distributed key-value database. It is the permanent memory of the Kubernetes cluster.

```
Simple mental model:

Key                          Value
──────────────────────────────────────────────
/deployments/backend         replicas=3, image=backend:v1
/services/backend-svc        port=5000, selector=backend
/pods/backend-pod-1          status=Running, node=Worker2
/nodes/worker-1              cpu=40%, ram=30%, status=Ready
```

Every piece of cluster state — desired and actual — lives in etcd. Every component reads the cluster's desired state from etcd. Every component writes status updates back through the API Server into etcd.

### The Stateless API Server / Stateful etcd Split

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  API Server   ←  stateless  →  processes requests  │
│                                                     │
│  etcd         ←  stateful   →  remembers state     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The API Server has no memory of its own. It reads and writes etcd on every operation. If the API Server restarts, it reads etcd and immediately has full knowledge of the cluster state.

This is identical to the backend API in this project:

```
Express (stateless)  →  processes requests
MySQL   (stateful)   →  stores application data

API Server (stateless)  →  processes cluster requests
etcd       (stateful)   →  stores cluster state
```

### What Happens if etcd Is Lost

If etcd is completely destroyed:

- The API Server is alive but has no memory
- `kubectl get pods` returns nothing — there is no state to return
- The cluster cannot know its desired configuration
- New workloads cannot be scheduled
- Self-healing cannot occur — there is nothing to reconcile against

etcd is therefore one of the most critical components in a production cluster. Production clusters back up etcd regularly, and it is typically run as a replicated cluster of 3 or 5 instances for fault tolerance.

The analogy:

```
MySQL stores application data.
etcd stores cluster state — Deployments, Services, Pods,
                            ConfigMaps, Secrets, Node metadata.
```

etcd does not store application business data (user records, transactions). It stores Kubernetes' own operational state.

---

## Scheduler

### Engineering Problem

The API Server stores the desired state: "run 3 backend Pods." etcd remembers it. But nothing has decided which Worker Nodes should run those Pods. A component is needed that looks at the cluster, evaluates resource availability, and makes placement decisions.

### What the Scheduler Does

The Scheduler is a single-responsibility component: given an unassigned Pod, determine which Worker Node should run it.

```
Cluster state (from etcd via API Server):

Worker A: CPU 5%,  RAM 20%
Worker B: CPU 40%, RAM 30%
Worker C: CPU 98%, RAM 95%

New backend Pod needs to start.

Scheduler evaluates:
→ Worker C: eliminate (near capacity)
→ Worker B: eligible
→ Worker A: eligible, lower load
→ Decision: assign to Worker A
```

The Scheduler does not start the container. It does not SSH into Worker A. It updates the API Server with the placement decision (the Pod's `nodeName` field is set). From that point, the kubelet on Worker A takes over.

### Why the Scheduler Is a Separate Component

The Scheduler could have been built into the API Server. It was deliberately separated for three reasons:

**Single Responsibility:** The API Server's job is to handle requests and maintain state. Scheduling requires heavy computation — evaluating constraints, affinity rules, resource availability, topology. Combining these in one process would slow both operations.

**Pluggability:** Kubernetes ships with a default scheduler. Any organization can replace it with a custom scheduler — one that understands their specific hardware, pricing model, or workload characteristics. If scheduling were inside the API Server, replacing it would require replacing the entire API Server.

**Throughput:** The API Server can accept and acknowledge requests in milliseconds because it only writes state. Scheduling happens asynchronously in the background. Under load, hundreds of Pod creation requests can be accepted and queued while the Scheduler processes them independently.

```
kubectl apply (100 Deployments)
        │
        ▼
API Server: validates, saves to etcd, returns 201 Created
(milliseconds per request)
        │
Background:
        ▼
Scheduler: evaluates placement for each Pod
(asynchronous, does not block API requests)
```

---

## The Desired State Model

This is the most important concept in Kubernetes. Every component in the system exists to implement it.

```
Desired State (stored in etcd)
        │
        ▼
Actual State (observed in the cluster)
        │
        ▼
Difference detected
        │
        ▼
Take action to reconcile
```

Example:

```
Desired:  backend Pods = 3
Actual:   backend Pods = 2   (one crashed)
Diff:     1 Pod missing
Action:   create 1 new Pod
```

Every Kubernetes component participates in this reconciliation loop. The Scheduler reconciles unscheduled Pods with available Nodes. The kubelet reconciles assigned Pods with running containers. The Controller Manager reconciles desired replica counts with actual running counts.

This model explains self-healing: Kubernetes does not need to receive a command to restart a crashed container. It continuously observes that the actual state diverges from the desired state and corrects it automatically.

---

## Worker Nodes and kubelet

### Engineering Problem

The Scheduler has decided that a Pod belongs on Worker B. Something must exist on Worker B to receive that decision and actually start the container. The Control Plane cannot SSH into Worker B — that would couple Control Plane operations to individual machine SSH configurations and make the system brittle.

### What kubelet Is

The kubelet is the Kubernetes agent running on every Worker Node. It is the bridge between the Control Plane's decisions and the container runtime's execution.

```
Kubernetes Cluster
                                 Control Plane
                                 API Server
                                      │
                 ─────────────────────────────────────
                 │                   │               │
         Worker A                Worker B         Worker C
         kubelet                  kubelet          kubelet
         containerd               containerd       containerd
         Pods                     Pods             Pods
```

There is one kubelet per Worker Node. The kubelet watches the API Server for Pods assigned to its node, instructs the container runtime to start them, monitors their health, and reports status back to the API Server.

### The Four Responsibilities of kubelet

**1. Receive assignments**
The kubelet watches the API Server. When a Pod is assigned to its node (the Pod's `nodeName` field is set to this node), the kubelet picks it up.

**2. Instruct the container runtime**
The kubelet does not create containers itself. It communicates with the container runtime (containerd) via the Container Runtime Interface (CRI) to pull images and start containers.

```
kubelet → CRI → containerd → pull image → start container
```

**3. Monitor Pods**
The kubelet runs liveness and readiness probes on running Pods. If a container fails its health check, the kubelet restarts it.

**4. Report status**
Every few seconds, the kubelet sends heartbeats and Pod status reports to the API Server. This is how the Control Plane knows the actual state of every Pod on every Node.

### The Complete Execution Flow

```
kubectl apply -f backend.yaml
        │
        ▼
API Server — validates, authenticates, authorizes
        │
        ▼
etcd — stores desired state:
       Deployment: backend
       Replicas: 3
       Image: backend:v1
        │
Background:
        ▼
Scheduler — detects 3 unscheduled Pods
           evaluates Worker A, B, C
           assigns:
             Pod 1 → Worker A
             Pod 2 → Worker B
             Pod 3 → Worker A
        │
        ▼
API Server — updates Pod nodeName fields in etcd
        │
        ▼
kubelet (Worker A) — watches API Server
                     sees 2 Pods assigned
        │
        ▼
containerd (Worker A) — pulls backend:v1 image
                        creates containers
                        starts Node.js process
        │
        ▼
kubelet (Worker A) — checks health
                     reports Running to API Server
        │
        ▼
etcd — actual state now matches desired state
```

### Why kubelet Is Separate from the Scheduler

The Scheduler's responsibility: decide which Node should run a Pod.
The kubelet's responsibility: ensure Pods assigned to this Node are running.

If the Scheduler also managed container execution on Worker Nodes:
- It would need to understand every operating system variant and container runtime
- A slow or unreachable Worker would block scheduling for the entire cluster
- The Scheduler would become tightly coupled to per-node execution details

By keeping kubelet on each Worker Node, Kubernetes separates decision-making from execution. The Scheduler can continue assigning work to healthy nodes even if one node's kubelet is struggling.

### Network Partition Behavior

If Worker B loses network connectivity with the Control Plane:

```
Worker B — Network cable cut
        │
        ▼
Containers on Worker B: STILL RUNNING
(containerd manages them locally)

Control Plane perspective:
kubelet heartbeats stopped
        │
        ▼ (after ~5 minutes)
Node marked NotReady
        │
        ▼
Controller Manager schedules replacement Pods on other Workers
```

Existing containers continue running because they are managed by the local container runtime, not by Kubernetes. The application keeps serving requests from Worker B. The Control Plane schedules replacements because it cannot distinguish between a network failure and a machine failure — it chooses safety and ensures the desired replica count is met elsewhere.

---

## Component Analogy Map

```
Docker ecosystem:            Kubernetes equivalent:

Docker CLI           →  kubectl
Docker Engine        →  API Server
(no equivalent)      →  etcd (cluster state database)
(no equivalent)      →  Scheduler (placement decisions)
(no equivalent)      →  Controller Manager (reconciliation loops)
containerd           →  containerd (same component, also used by K8s)
Docker container     →  Pod (wrapping containers)
```

The progression through the call chain:

```
Docker:
Docker CLI → Docker Engine → containerd → Container

Kubernetes:
kubectl → API Server → etcd → Scheduler → API Server → kubelet → containerd → Container
```

Kubernetes has more components because it solves more problems. Each additional component exists to solve one of the four problems: Scheduling, Self-Healing, Scaling, Service Discovery.

---

## Pods — Why They Exist

### Engineering Problem

Docker deploys containers. Kubernetes could have copied Docker's model and deployed containers directly. It did not. Instead, Kubernetes introduced a new abstraction: the Pod.

To understand why, consider a realistic backend deployment:

```
Backend service in production:

┌──────────────────────────────────────────┐
│  Backend Pod                             │
│                                          │
│  ┌──────────────────┐                   │
│  │  backend container│  main application │
│  │  (Node.js)        │                   │
│  └──────────────────┘                   │
│                                          │
│  ┌──────────────────┐                   │
│  │  log-shipper      │  sends logs to    │
│  │  container        │  centralized log  │
│  └──────────────────┘  store            │
│                                          │
│  ┌──────────────────┐                   │
│  │  metrics-agent   │  exposes metrics  │
│  │  container        │  to Prometheus    │
│  └──────────────────┘                   │
└──────────────────────────────────────────┘
```

These three containers share a lifecycle: they start together, stop together, and always run on the same machine. They also share a network — `log-shipper` reads logs from `backend` via `localhost`, and `metrics-agent` reads metrics via `localhost`. And they may share a filesystem through volumes.

### What a Pod Is

A Pod is the smallest deployable unit in Kubernetes. It is a group of one or more containers that:

- Always start and stop together
- Always run on the same Worker Node
- Share the same network namespace (same IP address, same `localhost`)
- Can share volumes

```
Pod
├── Shared IP address
├── Shared localhost
├── Shared volumes (optional)
└── Containers
    ├── Container 1 (main application)
    ├── Container 2 (sidecar — logging, monitoring, proxying)
    └── Container N
```

### Why Not Deploy Containers Directly

Deploying containers directly would require Kubernetes to understand grouping, co-location, and shared-network semantics at the container level. Instead, Kubernetes groups containers into Pods and manages Pods as the atomic unit.

From the scheduler's perspective: schedule this Pod on a node. From the networking perspective: assign this Pod one IP address. From the storage perspective: mount this volume into this Pod. The Pod is the unit everything else operates on.

In practice, most Pods in this project contain exactly one container. The Pod abstraction still exists because it provides the consistent interface Kubernetes uses for scheduling, networking, and storage — regardless of whether a Pod contains one container or several.

---

## Pod Internals — The Pause Container

Understanding why Pods provide shared networking requires going one level deeper into how the Linux kernel implements the isolation that Pods expose.

### Linux Namespaces — The Foundation

A container is a Linux process running inside a restricted namespace. The kernel provides:

- **Network namespace** — a private virtual networking stack: its own routing table, firewall rules, IP loopback interface, and port table
- **PID namespace** — the process sees only its own process tree; its main process appears as PID 1
- **Mount namespace** — the process sees only a specific portion of the filesystem

A standard Docker container receives its own isolated instance of each of these namespaces. It has its own IP address, its own localhost, its own filesystem view — entirely separate from every other container on the same machine.

### The Multi-Container Problem

Two containers in separate network namespaces cannot communicate via localhost. They would need to make network calls between their respective IP addresses — adding latency, complexity, and configuration.

If one container's namespace is destroyed (because that container crashes), the other container loses its network connection, even if the connection was to a third container that is still running.

### The Pause Container Solution

When Kubernetes creates a Pod, the container runtime first launches a minimal process called the **Pause container** (also called the infra container):

```
Pod creation sequence:

1. containerd starts Pause container
   → Pause container calls pause() in C — an infinite sleep
   → Linux assigns a network namespace to Pause container
   → Pod IP address is bound to this network namespace
   → Network namespace is now stable and permanent

2. Backend container starts
   → Instead of a new network namespace, it joins Pause container's namespace
   → Sees the same IP, same localhost, same port table

3. Log Collector container starts
   → Also joins Pause container's network namespace
   → Same IP, same localhost
```

The Pause container holds the network namespace open. If the backend container crashes and restarts, its namespace disappears — but it was joined to the Pause container's namespace, not the other way around. The Pause container never stops. The network namespace stays alive. The Pod IP address never changes.

```
Pod
├── Pause container (holds network namespace, IP: 10.244.1.17)
│     └── Network namespace (shared by all containers in Pod)
│
├── Backend container (joins Pause network namespace)
│     └── localhost:5000 — reachable by any container in this Pod
│
└── Log Collector container (joins Pause network namespace)
      └── localhost reads logs from backend via shared namespace
```

This is the mechanism behind "containers in a Pod share localhost" — they literally share the same network namespace, which is owned and held open by the invisible Pause container.

### Shared Volumes

Storage sharing follows the same model at the filesystem layer. A volume declared in the Pod spec is mounted into the MNT namespace of each container that requests it. The Backend writes to `/var/log/app.log`. The Log Collector reads from the same path. Both see the same bytes because both are mounted into the same directory on the Worker Node's disk.

---

## Controller Manager

### Engineering Problem

ReplicaSets maintain a desired number of Pods. Deployments manage rolling updates. Services track healthy Pod endpoints. Who runs these reconciliation loops? Who compares desired state to actual state, continuously, for every object in the cluster?

This is the Controller Manager's role.

### What the Controller Manager Is

The Controller Manager is a single process that hosts many independent controllers. Each controller watches one type of Kubernetes object and runs a continuous reconciliation loop for it.

```
Controller Manager process
├── ReplicaSet Controller   — ensures N Pods are running
├── Deployment Controller   — manages ReplicaSets for rolling updates
├── Node Controller         — detects node failures, evicts Pods
├── Job Controller          — ensures batch jobs complete
├── Namespace Controller    — creates default resources in new namespaces
├── ServiceAccount Controller
└── ... (many more)
```

The Controller Manager does not make scheduling decisions (that is the Scheduler's job). It does not start containers (that is the kubelet's job). It watches the desired state in etcd via the API Server and compares it to the actual state of the cluster, then requests changes through the API Server when a difference is found.

### The Reconciliation Loop Pattern

Every controller in the Controller Manager follows the same loop:

```
LOOP (running continuously):
    │
    ▼
Observe actual state (via API Server)
    │
    ▼
Read desired state (from etcd via API Server)
    │
    ▼
Compute difference (delta = desired - actual)
    │
    ▼
If delta ≠ 0: take corrective action (via API Server)
    │
    ▼
Return to top of loop
```

**The delta calculation:**

| Desired | Actual | Delta | Action |
|---|---|---|---|
| 3 | 3 | 0 | None |
| 3 | 2 | +1 | Create 1 Pod |
| 3 | 5 | -2 | Delete 2 Pods |

The reconciliation loop does not care how the cluster reached its current state. A Pod may have been manually deleted, crashed due to an OOM error, or disappeared because a node lost power. The loop sees only the current delta and corrects it. This is why Kubernetes is self-healing — the correction mechanism is continuous, not event-driven.

**Event-driven vs reconciliation-driven:**

```
Event-driven (fragile):
Pod crashes → trigger event → create new Pod
Problem: if the event is lost, the Pod is never recreated.

Reconciliation-driven (resilient):
LOOP → Pod count is 2 but desired is 3 → create Pod
The fix happens regardless of whether an event was received.
```

### Why the Controller Manager Exists as a Separate Process

The Scheduler could have included replica management. The API Server could have included version management. They were separated for the same reason every Kubernetes component is separated — single responsibility, pluggability, and fault isolation. If the Controller Manager crashes, the API Server and Scheduler continue functioning. Existing Pods keep running. The cluster does not collapse — it simply stops self-healing until the Controller Manager is restarted.

---

## ReplicaSets

### Engineering Problem

A standalone Pod has no guarantee of staying alive. If it crashes, it is gone. If the node it runs on fails, it is gone. There is no record of how many copies should exist.

Applications need a declarative guarantee: "always run exactly N copies of this Pod."

### What a ReplicaSet Is

A ReplicaSet is a Kubernetes object that declares a desired number of identical Pod replicas and delegates to the ReplicaSet Controller to continuously maintain that count.

```
apiVersion: apps/v1
kind: ReplicaSet
spec:
  replicas: 3        ← desired count
  selector:          ← which Pods this ReplicaSet owns
  template:          ← Pod spec to create when count is low
```

The ReplicaSet itself is data stored in etcd. The ReplicaSet Controller reads it, counts running Pods matching the selector, and creates or deletes Pods as needed.

### The Factory Manager Analogy

A factory manager has one rule: keep exactly 10 workers on the floor at all times. The manager does not know how to manufacture anything. The manager only counts, hires, and fires. When a worker leaves sick, the manager immediately hires a replacement. When the floor is overstaffed, the manager reduces headcount.

The ReplicaSet Controller is that manager. It does not understand the application. It counts, creates, and deletes Pods.

### What Happens When a Pod Is Manually Deleted

```
kubectl delete pod backend-2
        │
        ▼
API Server removes Pod object from etcd
        │
        ▼
ReplicaSet Controller's reconciliation loop:
  Desired: 3
  Actual:  2
  Delta:   +1
        │
        ▼
ReplicaSet Controller requests new Pod creation via API Server
        │
        ▼
API Server stores new Pod in etcd
        │
        ▼
Scheduler assigns Pod to a Worker Node
        │
        ▼
kubelet starts the container
        │
        ▼
Pod count returns to 3
```

The ReplicaSet does not distinguish between "the administrator deleted this" and "the node crashed." Both produce the same delta. Both produce the same response: create a Pod.

### What ReplicaSet Does Not Do

A ReplicaSet does not manage application versions. If the image changes from `backend:v1` to `backend:v2`, the ReplicaSet cannot orchestrate a rolling replacement. It only knows how to maintain count — not how to safely transition between versions. That limitation is precisely why Deployments exist.

---

## Deployments

### Engineering Problem

ReplicaSets keep N Pods alive. But production applications need to release new versions without downtime, and they need to be able to reverse those releases quickly when bugs are discovered. ReplicaSets have no mechanism for this.

### What a Deployment Is

A Deployment is a higher-level Kubernetes object that manages ReplicaSets and provides:

- **Rolling updates** — transition from one version to another without downtime
- **Rollbacks** — return to a previous version instantly
- **Update history** — audit trail of what was deployed when

The Deployment manages ReplicaSets. ReplicaSets manage Pods. Pods contain containers.

```
Deployment
    │  manages
    ▼
ReplicaSet (v1 — scaling down)   ReplicaSet (v2 — scaling up)
    │                                 │
    ▼                                 ▼
Pod v1   Pod v1                Pod v2   Pod v2   Pod v2
```

### Why a New ReplicaSet Is Created — Not Modified

When a Deployment receives an updated image tag, it does not modify the existing ReplicaSet. It creates a new ReplicaSet for the new version and manages two ReplicaSets simultaneously during the transition.

```
Before update:
ReplicaSet v1: 3 Pods (backend:v1)

Update to backend:v2:
ReplicaSet v1: 3 → 2 → 1 → 0 Pods
ReplicaSet v2: 0 → 1 → 2 → 3 Pods

After update:
ReplicaSet v1: 0 Pods (scaled down, but preserved)
ReplicaSet v2: 3 Pods (backend:v2)
```

ReplicaSet v1 is not deleted. It is scaled to zero and retained in etcd. This is the mechanism that makes rollback instant — the previous ReplicaSet configuration already exists:

```
Rollback to v1:
ReplicaSet v2: 3 → 2 → 1 → 0 Pods
ReplicaSet v1: 0 → 1 → 2 → 3 Pods

Total time: seconds
No image rebuild. No YAML recalculation.
```

### The Rolling Update Sequence

```
Desired: backend:v2, replicas: 3
Current: backend:v1, 3 Pods running

Step 1: Start 1 new v2 Pod
  v1: [Pod] [Pod] [Pod]
  v2: [Pod]

Step 2: v2 Pod passes health check → remove 1 v1 Pod
  v1: [Pod] [Pod]
  v2: [Pod] [Pod]

Step 3: Start 1 more v2 Pod
  v1: [Pod] [Pod]
  v2: [Pod] [Pod] [Pod]

Step 4: v2 Pod healthy → remove 1 v1 Pod
  v1: [Pod]
  v2: [Pod] [Pod] [Pod]

Step 5: Start final v2 Pod... (already at 3) → remove last v1 Pod
  v1: []
  v2: [Pod] [Pod] [Pod]

Result: zero downtime, full version transition
```

### The Complete Object Hierarchy

```
Deployment
    │
    ▼
ReplicaSet (version management)
    │
    ▼
Pods (execution units)
    │
    ▼
Containers (application processes)
```

In practice, engineers write Deployment YAML. Kubernetes automatically creates and manages ReplicaSets. Engineers rarely interact with ReplicaSets directly.

---

## Services

### Engineering Problem

Pods are ephemeral. When a Pod crashes and is recreated by a ReplicaSet, the new Pod receives a new IP address. If the frontend is configured to communicate with `10.244.1.17` (the backend Pod's IP), and that Pod is replaced with a new Pod at `10.244.2.31`, the frontend loses the connection.

Additionally, three backend Pods running simultaneously cannot all be reached at the same IP. Traffic must be distributed across them.

```
Problem:
Frontend → backend Pod IP: 10.244.1.17
Pod crashes. New Pod: 10.244.2.31
Frontend still sending to 10.244.1.17 → connection refused
```

### What a Service Is

A Service is a stable network identity for a set of Pods. It provides:

- **A stable IP address** that does not change when Pods are replaced
- **A DNS name** resolvable by other services in the cluster
- **Load balancing** across all healthy Pod replicas

```
Frontend
    │
    │  GET http://backend-service:5000
    ▼
Service: backend-service
    │  stable IP: 10.96.45.12 (ClusterIP — never changes)
    │  DNS: backend-service.default.svc.cluster.local
    │
    ├── Pod 1: 10.244.1.17  (healthy → receives traffic)
    ├── Pod 2: 10.244.2.31  (healthy → receives traffic)
    └── Pod 3: 10.244.3.8   (healthy → receives traffic)
```

When Pod 1 crashes and is replaced with Pod 4 at `10.244.1.42`, the Service updates its endpoint list automatically. The frontend continues sending to `backend-service:5000` without any configuration change.

### How Services Find Pods — Label Selectors

Services do not track Pods by name or IP. They use **label selectors**: a set of key-value pairs that a Pod must have to be included in the Service's endpoint list.

```
Service selector:
  app: backend

Pods with label app: backend → included in Service endpoints
Pods without label app: backend → not included
```

When a new Pod is created by a Deployment with `app: backend` in its labels, it is automatically added to the Service's endpoint list. When a Pod is deleted, it is automatically removed. No manual endpoint management is required.

### Service Types

| Type | Accessibility | Use Case |
|---|---|---|
| `ClusterIP` | Within cluster only | Service-to-service communication |
| `NodePort` | From outside cluster via Node IP + port | Development, direct external access |
| `LoadBalancer` | From outside via cloud load balancer | Production external access on cloud |

**ClusterIP** (default) — assigns a stable virtual IP address reachable only within the cluster. Used for backend-to-database and frontend-to-backend communication where external access is not required.

**NodePort** — opens a specific port on every Worker Node. External traffic can reach the Service via `<any-node-ip>:<nodePort>`. Used in development environments or bare-metal deployments without cloud load balancers.

**LoadBalancer** — provisions a cloud provider load balancer (AWS ELB, GCP LB) automatically and routes external traffic to the Service. Used in production on cloud platforms.

### The Connection to Docker Compose DNS

The Service DNS model is the production-scale equivalent of Docker Compose's service name DNS:

```
Docker Compose:                    Kubernetes:
Service name: mysql              Service name: mysql-service
DB_HOST=mysql                    DB_HOST=mysql-service
Docker DNS resolves mysql        kube-dns resolves mysql-service
→ MySQL container IP             → MySQL Pod IPs (load balanced)
```

In Docker Compose, one container per service. In Kubernetes, a Service fronts one or many Pod replicas. The naming and DNS resolution model is the same pattern at different scales.

### kube-proxy

kube-proxy is a component running on every Worker Node that maintains the networking rules that implement Services. When a new Service is created, kube-proxy reads the Service definition from the API Server and programs iptables (or IPVS) rules on the node to forward traffic destined for the Service's ClusterIP to the actual Pod IPs.

```
Traffic to 10.96.45.12:5000 (Service ClusterIP)
    │
    ▼
kube-proxy iptables rules on Worker Node
    │
    ▼
Distributed to one of:
  10.244.1.17:5000 (Pod 1)
  10.244.2.31:5000 (Pod 2)
  10.244.3.8:5000  (Pod 3)
```

---

## Complete Kubernetes Control Flow

With all components established, the complete flow from `kubectl apply` to a browser receiving a response:

```
Developer: kubectl apply -f deployment.yaml
        │
        ▼
API Server
  ├── Authenticates request
  ├── Validates YAML
  ├── Writes Deployment to etcd
  └── Returns 201 Created (milliseconds)
        │
Background (asynchronous):
        ▼
Deployment Controller (in Controller Manager)
  ├── Sees new Deployment in etcd
  ├── Creates ReplicaSet in etcd
  └── ReplicaSet desired count: 3
        │
        ▼
ReplicaSet Controller (in Controller Manager)
  ├── Sees ReplicaSet with 0 running Pods
  ├── Creates 3 Pod objects in etcd
  └── Pods are unscheduled
        │
        ▼
Scheduler
  ├── Sees 3 unscheduled Pods in etcd
  ├── Evaluates Worker Node resources
  ├── Assigns each Pod to a Node
  └── Updates Pod nodeName in etcd
        │
        ▼
kubelet (on each assigned Worker Node)
  ├── Sees Pod assigned to this node
  ├── Instructs containerd to pull image
  ├── containerd creates container
  ├── Container process starts (PID 1 in container)
  └── kubelet reports Running to API Server
        │
        ▼
etcd: actual state now matches desired state
        │
User request:
        ▼
Browser → Service (ClusterIP or LoadBalancer)
        │
        ▼
kube-proxy routes to one of 3 Pod IPs
        │
        ▼
Pod receives request
        │
        ▼
Container process handles request
        │
        ▼
Response returned to browser
```

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Why Kubernetes exists — the four problems | Complete |
| Docker vs Docker Compose vs Kubernetes mental model | Complete |
| The engineering history: Monolith → Microservices → Borg → Kubernetes | Complete |
| What is a Kubernetes Cluster | Complete |
| Control Plane vs Worker Node — roles and separation | Complete |
| Why a centralized Control Plane is necessary | Complete |
| API Server — purpose, responsibilities | Complete |
| etcd — cluster memory, stateless / stateful split | Complete |
| Scheduler — placement decisions | Complete |
| Desired State model | Complete |
| kubelet — the Worker Node agent | Complete |
| Complete end-to-end execution flow | Complete |
| Component analogy map — Docker to Kubernetes | Complete |
| Pods — why they exist, shared network namespace | Complete |
| Pause container — how Pod networking actually works | Complete |
| Controller Manager — the reconciliation engine | Complete |
| Reconciliation loop pattern — delta model | Complete |
| ReplicaSets — desired Pod count enforcement | Complete |
| Deployments — rolling updates, rollbacks, version management | Complete |
| Why Deployments create new ReplicaSets rather than modifying existing ones | Complete |
| Services — stable network identity, label selectors | Complete |
| Service types — ClusterIP, NodePort, LoadBalancer | Complete |
| kube-proxy — iptables rules implementing Services | Complete |
| Complete kubectl → browser response flow | Complete |

### Remaining — Phase 5 to Phase 6

| Topic | Status |
|---|---|
| Kubernetes YAML structure and field reference | Pending |
| Phase 6 — Backend Kubernetes manifests (`K8s/backend.yaml`) | Pending |
| Phase 7 — Frontend Kubernetes manifests (`K8s/frontend.yaml`) | Pending |
| MySQL on Kubernetes — PersistentVolumes and StorageClasses | Pending |
| `K8s/sc.yaml` — StorageClass analysis | Pending |

### Phase 5 Status: Complete

All Kubernetes foundational concepts have been established from first principles. The architecture is fully understood from `kubectl apply` through the complete execution path to a running Pod serving traffic through a Service. Phase 6 begins the practical application of this knowledge to the project's actual Kubernetes manifests.
