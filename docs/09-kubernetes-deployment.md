# Phase 6 — Kubernetes Deployment

## Objective

Phase 6 applies everything built in Phases 0 through 5 to the actual project. The focus shifts from architecture to implementation — from understanding why components exist to expressing them in YAML manifests and observing their behavior on a real cluster.

The methodology does not change:

```
Business Problem
      │
      ▼
Engineering Problem
      │
      ▼
Architecture
      │
      ▼
Prediction
      │
      ▼
Open Original Manifest
      │
      ▼
Explain Every Field
      │
      ▼
Apply
      │
      ▼
Observe
      │
      ▼
Break → Debug → Fix
      │
      ▼
Document → Commit
```

---

## Why Kubernetes Needs Deployments — Not Raw Containers

### Engineering Problem

Before opening a single YAML file, the question was posed: why can't Kubernetes simply run containers with `docker run` across Worker Nodes? What production problem would appear if Kubernetes only managed individual containers?

The answer connects every Phase 5 concept:

**1. Loss of Self-Healing**
A raw container has no desired state stored anywhere. The Controller Manager's reconciliation loop compares desired state to actual state to trigger recovery. Without a Deployment and ReplicaSet defining desired state in etcd, there is nothing to reconcile against. A crashed container stays crashed permanently.

**2. Blind Scheduling**
`docker run` runs on the local machine. In a distributed cluster, Kubernetes needs the Scheduler to evaluate cluster-wide resource availability — CPU, RAM, node affinity, topology constraints — and make placement decisions. Raw containers bypass the Scheduler entirely. Containers pile onto one node until it exhausts resources and crashes.

**3. Zero-Downtime Updates Are Impossible**
Updating from v1 to v2 without a Deployment requires stopping v1 containers and starting v2 containers — creating downtime. The rolling update mechanism (two ReplicaSets, traffic shifted incrementally) requires a Deployment object to orchestrate the transition.

**4. No Elastic Scaling**
Scaling from 3 to 30 containers without a Deployment requires manually issuing 27 separate commands on specific machines and updating load balancers. A Deployment changes one field (`replicas: 30`) and the entire orchestration follows automatically.

**Summary — What Is Lost Without Deployments:**

| Capability | Raw Containers | Deployments |
|---|---|---|
| Self-healing | ❌ | ✅ Reconciliation loop |
| Cluster-wide scheduling | ❌ | ✅ Scheduler |
| Zero-downtime updates | ❌ | ✅ Rolling update |
| Elastic scaling | ❌ Manual | ✅ Declarative |
| Desired state tracking | ❌ | ✅ etcd |
| Rollback | ❌ | ✅ Previous ReplicaSet preserved |

Without Deployments, Kubernetes would be Docker running independently on many machines — not a coordinated distributed system.

---

## Repository Structure

The repository is organised so that Kubernetes manifests live at the root level alongside the application source, not inside any individual service directory. Manifests belong to the entire application, not to a single tier.

```
docker-kubernetes-cicd-implementation/
│
├── api/                    ← Backend Node.js source + Dockerfile
├── client/                 ← Frontend React source + Dockerfile
│
├── Kubernetes/             ← All Kubernetes manifests
│   ├── namespace/          ← Namespace definitions
│   ├── mysql/              ← MySQL: secret, configmap, pvc, deployment, service
│   ├── backend/            ← Backend: deployment, service
│   ├── frontend/           ← Frontend: deployment, service
│   ├── storage/            ← StorageClass definitions
│   └── ingress/            ← Ingress rules (future)
│
├── docs/                   ← Engineering documentation
├── docker-compose.yaml     ← Local development
├── .gitignore
└── README.md
```

This structure scales cleanly through the remaining roadmap phases — Ingress, Helm, Terraform, monitoring — without requiring structural refactoring.

---

## Deployment Manifest — Conceptual Design

Before examining YAML syntax, the conceptual requirements for a Deployment were derived from the Phase 5 architecture:

```
Deployment
    │
    ▼
Metadata
    • Name          — unique identifier in the namespace
    • Labels        — for organisation and querying
    • Namespace     — logical isolation from other environments
    │
    ▼
Specification
    • Desired replicas     — what ReplicaSet enforces
    • Selector             — which Pods this Deployment owns
    • Pod Template         — blueprint for creating Pods
    │
    ▼
Container Specification
    • Image              — what containerd pulls and runs
    • Port               — documentation of application's listening port
    • Environment Vars   — configuration injected by kubelet
```

A Deployment does not contain existing Pods. It contains a Pod template — a blueprint. Whenever the ReplicaSet needs to create a Pod to satisfy the desired count, it creates one according to this template. The relationship is analogous to a Docker image (blueprint) and a container (instance).

---

## Backend Deployment Manifest — Field-by-Field Analysis

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: prod
  labels:
    app: backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: anshuman0506/backend:latest
          ports:
            - containerPort: 5000
          env:
            - name: DB_HOST
              value: mysql
            - name: DB_USER
              value: root
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: password
            - name: DB_NAME
              valueFrom:
                configMapKeyRef:
                  name: mysql-config
                  key: database
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: jwt-secret
```

---

### apiVersion: apps/v1

**Engineering Problem:** Kubernetes evolves continuously. New API versions introduce new fields and deprecate old ones. Without versioning, a cluster upgrade could silently misinterpret an existing manifest using outdated field semantics.

**What it does:** Tells the API Server which version of the Kubernetes API schema to use when parsing and validating this object. `apps/v1` is the stable, production-ready API group for Deployment objects.

**Component:** API Server. It reads `apiVersion` and `kind` first to determine which schema to validate against before storing the object in etcd.

**If missing:** The API Server rejects the manifest immediately — it cannot determine which validation rules to apply.

---

### kind: Deployment

**Engineering Problem:** Kubernetes manages many different object types — Pods, Services, ConfigMaps, Secrets, Ingresses. The system must know which type of object is being declared to route it to the correct controller.

**What it does:** Declares that this object is a Deployment. The API Server stores it with the correct type metadata. The Deployment Controller in the Controller Manager watches for objects of `kind: Deployment` and acts on them.

**Component:** API Server (stores it), Deployment Controller (watches and acts on it).

**If missing:** The manifest is rejected. Kubernetes cannot determine what to create.

---

### metadata.name: backend

**Engineering Problem:** Every object in a Kubernetes namespace must have a unique name so that operators, controllers, and CLI tools can reference it unambiguously.

**What it does:** Assigns the string `backend` as the primary key for this Deployment object in etcd. Commands like `kubectl get deployment backend` and `kubectl rollout history deployment/backend` use this name.

**Component:** API Server and etcd — the name becomes the lookup key in the cluster database.

**If missing:** Manifest validation fails. Resources cannot exist without a name.

---

### metadata.namespace: prod

**Engineering Problem:** A single Kubernetes cluster may host multiple environments — development, staging, production — on the same physical hardware. Without isolation, a developer's test deployment could interfere with a production workload.

**What it does:** Places this Deployment in the `prod` namespace, logically isolating it from objects in other namespaces. DNS resolution, RBAC policies, and resource quotas can be scoped per namespace.

**Component:** API Server uses the namespace when writing to etcd, ensuring objects in different namespaces do not collide even if they share the same name.

**If missing:** The Deployment is created in the `default` namespace. Production and development resources mix, losing isolation.

**Project connection:** The `prod` namespace must be created before applying this manifest. If the namespace does not exist, the apply command fails with `namespaces "prod" not found`.

---

### metadata.labels: app: backend

**Engineering Problem:** In a cluster with dozens or hundreds of objects, operators need to filter and query resources without knowing every individual name.

**What it does:** Attaches a key-value label to the Deployment object itself. Does not affect the Pods or their networking. Used for `kubectl get deployments -l app=backend` and similar administrative queries.

**Component:** Informational for the API Server and administrative tools.

**If missing:** The Deployment functions correctly but is harder to query and audit.

---

### spec.replicas: 3

**Engineering Problem:** A single Pod provides no fault tolerance — if the node it runs on fails, the application goes down. Three replicas ensure the application survives the loss of one node.

**What it does:** Declares the desired state: exactly 3 backend Pods should exist at all times. The ReplicaSet Controller reads this value, counts running Pods matching the selector, and creates or deletes Pods to match.

**Component:** Deployment Controller creates a ReplicaSet with `replicas: 3`. The ReplicaSet Controller enforces the count continuously via the reconciliation loop.

**If missing:** Defaults to 1. One Pod failure or one node failure produces complete backend downtime.

**The desired state declaration:** Writing `replicas: 3` is not an instruction to "create 3 Pods now." It is a declaration that the desired state of the cluster includes 3 backend Pods. The Controller Manager continuously reconciles reality against this declaration.

---

### spec.selector.matchLabels: app: backend

**Engineering Problem:** A cluster may have dozens of Pods from different Deployments. The ReplicaSet Controller must know which Pods it owns so it counts and manages only those, not unrelated Pods.

**What it does:** Defines the label query the ReplicaSet uses to identify its Pods. The ReplicaSet Controller continuously runs: "count Pods where `app=backend`; if count ≠ 3, reconcile."

**Component:** ReplicaSet Controller queries this selector against the API Server on every reconciliation loop iteration.

**If missing:** The manifest fails validation. Kubernetes refuses to create a Deployment without a selector — a controller with no ownership boundary is operationally dangerous.

**Critical constraint:** The `selector.matchLabels` value must exactly match the `template.metadata.labels` value. If they differ, the ReplicaSet creates Pods with one label but searches for Pods with a different label — finding nothing, it creates Pods indefinitely in an infinite loop.

---

### spec.template.metadata.labels: app: backend

**Engineering Problem:** Created Pods must carry the label that the selector queries. Without this label, the ReplicaSet cannot recognise the Pods it just created.

**What it does:** Every Pod created from this template is tagged with `app: backend`. This is the label the selector matches. It is also the label that Services use to route traffic to these Pods.

**Component:** ReplicaSet Controller injects this label into every Pod it creates. The Service selector uses the same label to identify healthy backend Pod endpoints.

**If missing:** Validation fails. If somehow allowed, the ReplicaSet cannot find its own Pods and creates an infinite number of them.

**Dual purpose:** These labels serve both the ReplicaSet (ownership identification) and the Service (traffic routing target).

---

### spec.template.spec.containers[0].name: backend

**Engineering Problem:** A Pod can contain multiple containers. Each must have a unique name within the Pod to be individually addressable for logging, health checks, and exec operations.

**What it does:** Names this container `backend` within the Pod. Used in `kubectl logs <pod> -c backend` and `kubectl exec <pod> -c backend`.

**Component:** kubelet uses the name when creating the Linux container via the container runtime.

**If missing:** Manifest validation fails — unnamed containers are not permitted.

---

### spec.template.spec.containers[0].image: anshuman0506/backend:latest

**Engineering Problem:** The Worker Node must know which container image to pull and run. The image encapsulates the complete runtime environment — OS, Node.js, dependencies, application code — built during Phase 2B.

**What it does:** Specifies the Docker Hub image reference. The kubelet passes this to containerd, which contacts Docker Hub, pulls the image layers, and creates the container.

**Component:** kubelet (receives the Pod spec), containerd (pulls the image), Docker Hub (image registry).

**If missing:** Container creation is impossible — no image to run.

**Project connection:** This image is the one built from `api/Dockerfile` in Phase 2B. The multi-layer image contains the Node.js runtime, production npm dependencies, and all application source code. The tag `:latest` should be replaced with a specific version tag (`:v1`, `:1.0.0`) in production to ensure deterministic deployments.

---

### spec.template.spec.containers[0].ports[0].containerPort: 5000

**Engineering Problem:** Engineers, monitoring tools, and Service configurations need to know which port the application inside the container listens on.

**What it does:** Documents that the container process listens on port 5000. This is metadata — it does not open the port, publish it, or create any networking rule.

**Component:** Informational. Used by Service `targetPort` configuration and monitoring tools.

**If missing:** The application still listens on port 5000 (Express calls `app.listen(5000)` regardless). However, automated Service discovery and tooling cannot dynamically determine the correct port.

**Project connection:** `api/app.js`:
```javascript
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => { ... });
```

This is identical to `EXPOSE 5000` in the Dockerfile — documentation of intent, not a networking configuration.

---

### env: DB_HOST: mysql

**Engineering Problem:** The backend application cannot have the database hostname hardcoded. The hostname changes between local development (`localhost`), Docker Compose (`mysql` service name), and Kubernetes (`mysql` Service name in the same namespace).

**What it does:** Injects `DB_HOST=mysql` into the container's Linux process environment before Node.js starts. The kubelet performs this injection during container initialization.

**Component:** kubelet injects the value into the container's environment variables before the application process starts.

**Project connection:** `api/models/db.js`:
```javascript
const db = mysql.createConnection({
  host: process.env.DB_HOST,  // ← reads "mysql" from environment
  ...
});
```

In Kubernetes, `mysql` is the name of the MySQL Service. kube-dns resolves `mysql` (within the same namespace) to the MySQL Service ClusterIP, which kube-proxy routes to the MySQL Pod. The connection chain: `DB_HOST=mysql` → kube-dns → ClusterIP → kube-proxy iptables → MySQL Pod → mysqld.

---

### env: DB_USER: value: root

**Engineering Problem:** The database username must be configurable without changing application code.

**What it does:** Injects `DB_USER=root` into the container environment.

**Project connection:** `api/models/db.js`:
```javascript
user: process.env.DB_USER,  // ← "root"
```

In production, a dedicated application user with least-privilege database permissions would replace `root`.

---

### env: DB_PASSWORD: valueFrom: secretKeyRef

**Engineering Problem:** Plaintext credentials in YAML files are a security violation. A Deployment manifest is version-controlled. Anyone with repository access would see the database password in plaintext.

**What it does:**
```yaml
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: mysql-secret
      key: password
```

Instead of embedding the password value directly, this instructs the kubelet to read the value from a Kubernetes Secret object named `mysql-secret`, extracting the key `password` from it at container creation time. The actual credential never appears in the Deployment manifest.

**Component:** kubelet fetches the Secret from the API Server at container initialization time and injects the decoded value as an environment variable.

**If missing or wrong key:** The Pod enters `CreateContainerConfigError` state — the kubelet cannot start the container because a required environment variable cannot be resolved. The application never starts.

**Project connection:** `api/models/db.js`:
```javascript
password: process.env.DB_PASSWORD,  // ← injected from Secret
```

**Security principle:** Secrets in Kubernetes are base64-encoded (not encrypted by default, though encryption at rest can be configured). The value is never stored in the Deployment YAML — only a reference to where the value lives.

---

### env: DB_NAME: valueFrom: configMapKeyRef

**Engineering Problem:** The database name is non-sensitive configuration that may differ between environments (development uses `crud_app_dev`, production uses `crud_app`). It should be externally configurable without rebuilding the image.

**What it does:**
```yaml
- name: DB_NAME
  valueFrom:
    configMapKeyRef:
      name: mysql-config
      key: database
```

Reads the database name from a ConfigMap object named `mysql-config`, key `database`. ConfigMaps store non-sensitive configuration data as plain key-value pairs.

**Component:** kubelet fetches the ConfigMap from the API Server at container initialization and injects the value.

**If missing or wrong key:** Container enters `CreateContainerConfigError`. The application cannot start because the database name is unresolvable.

**Project connection:** `api/models/db.js`:
```javascript
database: process.env.DB_NAME,  // ← injected from ConfigMap
```

**Secret vs ConfigMap distinction:**

| | Secret | ConfigMap |
|---|---|---|
| Data type | Sensitive (passwords, keys) | Non-sensitive (config values) |
| Storage | Base64-encoded in etcd | Plaintext in etcd |
| Use case | `DB_PASSWORD`, `JWT_SECRET` | `DB_NAME`, feature flags, URLs |

---

### env: JWT_SECRET: valueFrom: secretKeyRef

**Engineering Problem:** The JWT signing secret must never appear in plaintext in any version-controlled file.

**What it does:** References `backend-secret`, key `jwt-secret`. The kubelet injects the decoded secret value at container initialization.

**Project connection:** `api/controllers/authController.js`:
```javascript
const SECRET = process.env.JWT_SECRET || 'supersecret';
const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '1h' });
```

The `|| 'supersecret'` fallback exists for local development. In Kubernetes, the injected value from the Secret replaces the fallback. Any token signed with one secret value cannot be verified with a different value — the JWT secret must be consistent across all backend replicas. Because all replicas read from the same Secret object, consistency is guaranteed.

---

## The Declarative Mental Model

Every field in the Deployment manifest is a declaration of desired state, not an instruction:

```
replicas: 3  →  "3 backend Pods should exist"
                 (not "create 3 Pods right now")

image: backend:latest  →  "Pods should run this image"
                           (not "pull this image now")

DB_HOST: mysql  →  "the DB_HOST environment variable should equal 'mysql'"
                    (not "connect to mysql now")
```

The Controller Manager, Scheduler, kubelet, and other components continuously work to make the actual state of the cluster match these declarations. The engineer declares intent. The system implements it.

This is the core shift from Docker (imperative: `docker run`, `docker stop`) to Kubernetes (declarative: `kubectl apply`, desired state).

---

## Deployment Sequence — Correct Order

Kubernetes objects have dependencies. A Deployment that references a Secret that does not exist yet will fail with `CreateContainerConfigError`. The correct application order follows the dependency graph:

```
1. Namespace
        │  (all other objects use it)
        ▼
2. Secrets
   (mysql-secret, backend-secret)
        │  (Deployments reference them)
        ▼
3. ConfigMap
   (mysql-config)
        │  (Deployments reference them)
        ▼
4. StorageClass + PersistentVolumeClaim
        │  (MySQL Deployment requires volume)
        ▼
5. MySQL Deployment + MySQL Service
        │  (Backend requires database)
        ▼
6. Backend Deployment + Backend Service
        │  (Frontend requires backend API)
        ▼
7. Frontend Deployment + Frontend Service
        │
        ▼
8. Ingress (future — external traffic routing)
```

Applying in any other order may produce Pods stuck in `Pending` or `CreateContainerConfigError` states.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Why Kubernetes needs Deployments, not raw containers | Complete |
| Repository structure established | Complete |
| Deployment manifest conceptual design — derived before YAML | Complete |
| `apiVersion` — schema versioning | Complete |
| `kind: Deployment` — object type routing | Complete |
| `metadata.name` — unique identifier | Complete |
| `metadata.namespace` — logical isolation | Complete |
| `metadata.labels` — administrative organisation | Complete |
| `spec.replicas` — desired state declaration | Complete |
| `spec.selector.matchLabels` — ReplicaSet ownership boundary | Complete |
| `spec.template.metadata.labels` — Pod identification for selector and Service | Complete |
| `containers[0].name` — container identity within Pod | Complete |
| `containers[0].image` — image registry reference | Complete |
| `containers[0].ports[0].containerPort` — documentation metadata | Complete |
| `env.DB_HOST` — database hostname via Kubernetes DNS | Complete |
| `env.DB_USER` — database authentication | Complete |
| `env.DB_PASSWORD` — Secret reference (no plaintext credentials) | Complete |
| `env.DB_NAME` — ConfigMap reference | Complete |
| `env.JWT_SECRET` — Secret reference for token signing | Complete |
| Declarative vs imperative mental model | Complete |
| Deployment dependency sequence | Complete |

### Remaining — Phase 6 Continuation

| Topic | Status |
|---|---|
| Backend Service manifest | Pending |
| MySQL Secret manifest | Pending |
| MySQL ConfigMap manifest | Pending |
| MySQL PersistentVolumeClaim manifest | Pending |
| MySQL Deployment manifest | Pending |
| MySQL Service manifest | Pending |
| Frontend Deployment manifest | Pending |
| Frontend Service manifest | Pending |
| Cluster setup — Minikube | Pending |
| Apply manifests and observe | Pending |
| Break and debug exercises | Pending |
| Rolling update observation | Pending |
| Engineering retrospective | Pending |
