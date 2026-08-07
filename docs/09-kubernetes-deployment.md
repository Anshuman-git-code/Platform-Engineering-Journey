# Phase 6 — Kubernetes Deployment

## Objective

Phase 6 applies everything built in Phases 0 through 5 to the actual project. The focus shifts from
architecture to implementation — from understanding why components exist to expressing them in YAML
manifests and observing their behavior on a real cluster.

The methodology does not change:

```
Business Problem → Engineering Problem → Architecture
→ Prediction → Open Manifest → Explain Every Field
→ Apply → Observe → Break → Debug → Fix → Document → Commit
```

---

## Why Kubernetes Needs Deployments — Not Raw Containers

Before opening a single YAML file, the engineering question was posed: why can't Kubernetes simply
run containers with `docker run` across Worker Nodes?

The answer connects every Phase 5 concept:

| Raw Container Management | Deployment-Driven Management |
|---|---|
| Manual placement | Automated Scheduling |
| Dead stays dead | Self-healing via Reconciliation Loop |
| Downtime deployments | Zero-downtime Rolling Updates |
| Fixed to a single host | Elastic Scaling across nodes |
| No desired state | etcd tracks desired state |
| No rollback | Previous ReplicaSet preserved |

Without Deployments, Kubernetes would be Docker running independently on many machines —
not a coordinated distributed system.

---

## Cluster Setup — Minikube

### Why Minikube

Minikube runs a complete single-node Kubernetes cluster inside a Docker container on the local
machine. For learning, it provides:

- A real Kubernetes API Server, etcd, Scheduler, Controller Manager, and kubelet
- No cloud cost
- Easy to break and reset
- Identical YAML to production clusters

When `minikube start` executes:

```
Mac
  │
  ▼
Docker Desktop
  │  creates container
  ▼
Minikube container
  ├── API Server
  ├── Scheduler
  ├── Controller Manager
  ├── etcd
  ├── kubelet
  ├── kube-proxy
  └── CoreDNS
```

Docker is not running the application. Docker is running an entire Kubernetes node.

### Cluster Verification

```bash
kubectl config use-context minikube
minikube start
kubectl cluster-info
```

Output confirmed:
- Single node: `minikube` — `control-plane` role — `v1.32.0`
- API Server reachable at `https://127.0.0.1:32771`
- CoreDNS running at the cluster DNS endpoint

### Pre-existing System Resources

Before any application was deployed, `kubectl get pods -A` revealed the complete Control Plane
running as Pods in `kube-system`:

| Pod | Role |
|---|---|
| `kube-apiserver-minikube` | Front door — every request passes through here |
| `kube-scheduler-minikube` | Placement decisions |
| `kube-controller-manager-minikube` | Reconciliation loops for all controllers |
| `etcd-minikube` | Cluster memory — all state persisted here |
| `kube-proxy-xhwws` | Programs Linux iptables rules for Services |
| `coredns-668d6bf9bc-vtlw6` | Internal DNS — resolves service names to ClusterIPs |
| `storage-provisioner` | Dynamically creates PersistentVolumes when PVCs are requested |

Every component studied in Phase 5 is now visible as a running Pod.

`kubectl get svc -A` revealed the `kubernetes` Service in the `default` namespace:

```
NAME         TYPE        CLUSTER-IP   PORT(S)
kubernetes   ClusterIP   10.96.0.1    443/TCP
```

This Service exposes the Kubernetes API Server to Pods running inside the cluster.
Kubernetes uses its own Service mechanism to expose its own API — the same abstraction
applied to all workloads applies to the Control Plane itself.

---

## Deployment Dependency Graph

Every resource in this phase has dependencies. Applying in the wrong order produces Pods
stuck in `Pending` or `CreateContainerConfigError`. The correct order:

```
Namespace
    │
    ├── ConfigMap (backend-config, mysql-initdb-config)
    ├── Secret (backend-secret)
    │
    ├── PersistentVolumeClaim (mysql-pvc)
    │         │
    │         ▼ (StorageClass auto-provisions PV)
    │   PersistentVolume
    │
    ├── MySQL Deployment
    │         │
    │         └── MySQL Service
    │
    ├── Backend Deployment
    │         │
    │         └── Backend Service
    │
    └── Frontend Deployment (Phase 7)
              │
              └── Frontend Service (Phase 7)
```

---

## Namespace

### Engineering Problem

Without namespaces, a single Kubernetes cluster shared by multiple teams produces:
- Security collapse — any Pod can reach any other Pod's network
- No RBAC scoping — permissions are all-or-nothing cluster-wide
- Resource starvation — no quotas per team
- Environment contamination — production and development mixed

### Manifest

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: prod
  labels:
    environment: production
```

`apiVersion: v1` — Namespace is a core Kubernetes resource, not an `apps/v1` workload object.
`labels` — administrative metadata; tools like ArgoCD, Prometheus, and OPA query these.

### Verification

```bash
kubectl apply -f Kubernetes/base/namespace.yaml
kubectl get namespaces
kubectl describe namespace prod
```

`describe` output confirmed:
- `Status: Active`
- `No resource quota` — documented as a future addition
- `kubernetes.io/metadata.name=prod` — injected automatically by the control plane

### Important Observation

Attempting `kubectl logs namespace/prod` returned `pods "ns" not found`. This was a valuable
diagnostic moment: `kubectl logs` targets running Pods, not declarative objects. A Namespace
has no PID 1, no container, no process — it generates no logs. Only runtime objects (Pods,
containers) produce logs.

---

## ConfigMap — backend-config

### Engineering Problem

Configuration values (`DB_HOST`, `DB_NAME`, `DB_USER`) must not be hardcoded in application
source code or in Deployment manifests. Hardcoding means:

- Changing the database name requires rebuilding the Docker image
- Multiple services that share the same database name must each be updated separately
- The same image cannot be deployed across different environments without code changes

### Manifest

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: backend-config
  namespace: prod
data:
  DB_HOST: mysql
  DB_NAME: crud_app
  DB_USER: root
```

### Project Connection

`api/models/db.js`:
```javascript
host: process.env.DB_HOST,   // ← "mysql" — resolves via CoreDNS to MySQL Service ClusterIP
database: process.env.DB_NAME, // ← "crud_app"
user: process.env.DB_USER,   // ← "root"
```

`DB_HOST: mysql` is the most important value. When the backend calls `mysql.createConnection`,
Node.js resolves `mysql` through CoreDNS → MySQL Service ClusterIP → kube-proxy iptables →
MySQL Pod. No IP address ever appears in application code.

### ConfigMap vs Deployment env

A single ConfigMap can be consumed by any number of Deployments. If the database name changes,
one ConfigMap update propagates to all consumers. No image rebuild. No Deployment change.

### Verification

```bash
kubectl apply -f Kubernetes/backend/configmap.yaml
kubectl describe configmap backend-config -n prod
```

`describe` displays all values in plain text — intentional, as these values are non-sensitive.

---

## Secret — backend-secret

### Engineering Problem

Credentials (`DB_PASSWORD`, `JWT_SECRET`) must never appear in version-controlled files.
Anyone with repository access would see them in plaintext.

### Manifest

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: backend-secret
  namespace: prod
stringData:
  DB_PASSWORD: Anshuman
  JWT_SECRET: devopsShackSuperSecretKey
```

`stringData` accepts plaintext — the API Server converts to base64 before storing in etcd.
`data` would require pre-encoded base64 values; `stringData` is the human-authoring form.

### Secret vs ConfigMap

| | ConfigMap | Secret |
|---|---|---|
| Data sensitivity | Non-sensitive | Sensitive |
| Storage in etcd | Plaintext | Base64-encoded |
| CLI display | Values shown | Values hidden (shows byte count) |
| Example use cases | `DB_HOST`, `PORT`, feature flags | `DB_PASSWORD`, `JWT_SECRET`, TLS keys |

### Project Connections

`api/models/db.js`:
```javascript
password: process.env.DB_PASSWORD   // ← from backend-secret
```

`api/controllers/authController.js`:
```javascript
const SECRET = process.env.JWT_SECRET || 'supersecret';
jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '1h' });
```

The same Secret serves both the backend Deployment (for JWT) and the MySQL Deployment
(for `MYSQL_ROOT_PASSWORD` via key mapping).

### Verification

```bash
kubectl apply -f Kubernetes/backend/secret.yaml
kubectl describe secret backend-secret -n prod
```

`describe` output:
```
DB_PASSWORD:  8 bytes
JWT_SECRET:   25 bytes
```

Values are hidden by default. The byte count confirms the values were stored.

---

## PersistentVolumeClaim — mysql-pvc

### Engineering Problem

MySQL writes database files to `/var/lib/mysql`. A container's writable layer is ephemeral —
deleted when the container is removed. Every Pod restart would produce an empty database.

Persistent storage must exist independently of any Pod's lifecycle:

```
Without PVC:
Pod restarts → container recreated → /var/lib/mysql empty → all data lost

With PVC:
Pod restarts → new container → mounts same PVC → /var/lib/mysql intact → data survives
```

### Why Compute and Storage Are Separated

Three engineering reasons:

1. **Compute mobility** — if Worker Node A fails, the Scheduler recreates the Pod on Worker
   Node B. Network-attached storage can be re-mounted on the new node. Data tied to a Pod's
   local filesystem cannot be moved.

2. **Clean runtime** — Kubernetes recreates Pods from scratch deliberately. A fresh container
   layer eliminates corrupted memory, deadlocked sockets, and dirty runtime state. The
   persistent volume is re-attached to this clean environment.

3. **Storage abstraction** — the application requests storage without knowing whether the
   underlying disk is an AWS EBS volume, a GCP Persistent Disk, a Ceph cluster, or a local
   directory. The StorageClass handles provisioning.

### Manifest

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pvc
  namespace: prod
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

**`accessModes: ReadWriteOnce`** — one node can mount this volume for read-write at a time.
Appropriate for MySQL: one writer, no concurrent multi-node disk access.

**No `storageClassName`** — Minikube provides a default StorageClass named `standard` backed
by `k8s.io/minikube-hostpath`. Omitting `storageClassName` causes Kubernetes to use the
default automatically.

### Dynamic Provisioning

Before applying the PVC:
```
kubectl get storageclass    → standard (default)  k8s.io/minikube-hostpath
kubectl get pv              → No resources found
kubectl get pvc -A          → No resources found
```

After applying:
```
mysql-pvc   Bound   pvc-ae85aec4-...   5Gi   RWO   standard
```

And a PersistentVolume was created automatically:
```
pvc-ae85aec4-...   5Gi   RWO   Delete   Bound   prod/mysql-pvc   standard
```

Nobody created the PV manually. The StorageClass provisioner (`k8s.io/minikube-hostpath`)
responded to the PVC request and created a `HostPath` volume at
`/tmp/hostpath-provisioner/prod/mysql-pvc` on the Minikube node.

This is the Kubernetes reconciliation loop applied to storage:
```
PVC created → PVC Controller notices → no PV satisfies it
→ calls StorageClass provisioner → provisioner creates PV
→ PV bound to PVC → PVC status: Bound
```

### Verification

```bash
kubectl apply -f Kubernetes/mysql/pvc.yaml
kubectl get pvc -n prod
kubectl get pv
kubectl describe pvc mysql-pvc -n prod
```

Events from `describe`:
```
ExternalProvisioning  Waiting for a volume to be created by the external provisioner
Provisioning          External provisioner is provisioning volume for claim "prod/mysql-pvc"
ProvisioningSucceeded Successfully provisioned volume pvc-ae85aec4-...
```

`Used By: <none>` — the volume exists but no Pod has mounted it yet.
This is the expected state before the MySQL Deployment is applied.

---

## MySQL ConfigMap — mysql-initdb-config

### Engineering Problem

The MySQL official Docker image executes any `.sql` or `.sh` files found in
`/docker-entrypoint-initdb.d/` during its first initialization (when the data directory
is empty). Without initialization scripts, MySQL creates the `crud_app` database
(from `MYSQL_DATABASE`) but does not create any tables.

The backend's `initAdminUser()` function in `api/app.js` queries the `users` table on startup.
Without the table:
```
Error: Table 'crud_app.users' doesn't exist
```

### ConfigMap as a File — Not Just Environment Variables

This is the second usage pattern of ConfigMaps. Previously, ConfigMaps were used to inject
environment variables. Here, a ConfigMap stores a SQL file that gets mounted into the
container's filesystem:

```
ConfigMap: mysql-initdb-config
    │  key: init.sql
    │  value: CREATE TABLE users ...
    │
    ▼ mounted as volume
/docker-entrypoint-initdb.d/init.sql   ← physical file inside container
    │
    ▼ MySQL entrypoint reads directory
Executes init.sql
    │
    ▼
users table created
```

Kubernetes delivers the file. MySQL executes it. Kubernetes has no knowledge of SQL.
The application is responsible for what it does with the mounted content.

### Manifest

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mysql-initdb-config
  namespace: prod
data:
  init.sql: |
    CREATE DATABASE IF NOT EXISTS crud_app;
    USE crud_app;
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
```

The `|` block scalar in YAML preserves the multi-line string as-is, including newlines.

### Why Not Put This In the MySQL Secret or backend-config?

Non-sensitive SQL schema belongs in a ConfigMap. Secrets are for credentials only.
Mixing schema SQL with application config (backend-config) would violate single-responsibility
and make the ConfigMap's purpose unclear.

---

## MySQL Deployment

### Engineering Problem

The MySQL Deployment wires together four independently created resources:

```
mysql-secret     → MYSQL_ROOT_PASSWORD (authentication)
backend-config   → MYSQL_DATABASE (database name)
mysql-initdb-config → /docker-entrypoint-initdb.d/init.sql (schema)
mysql-pvc        → /var/lib/mysql (persistent data)
```

### replicas: 1

MySQL runs as a single instance. Using `replicas: 3` with a `ReadWriteOnce` PVC would cause:
- Pods 2 and 3 to fail with `Multi-Attach error` — a second node cannot mount an RWO volume
- If they somehow shared the disk, concurrent MySQL instances would corrupt the data

For learning, a single-instance MySQL Deployment is correct. Production would use a StatefulSet
with `volumeClaimTemplates` to give each replica its own dedicated PVC.

### Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql
  namespace: prod
  labels:
    app: mysql
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3306
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DB_PASSWORD
            - name: MYSQL_DATABASE
              valueFrom:
                configMapKeyRef:
                  name: backend-config
                  key: DB_NAME
          volumeMounts:
            - name: mysql-storage
              mountPath: /var/lib/mysql
            - name: initdb
              mountPath: /docker-entrypoint-initdb.d
      volumes:
        - name: mysql-storage
          persistentVolumeClaim:
            claimName: mysql-pvc
        - name: initdb
          configMap:
            name: mysql-initdb-config
```

### Field-by-Field Reasoning

**`MYSQL_ROOT_PASSWORD` from `backend-secret.DB_PASSWORD`**

The MySQL image's entrypoint script reads `MYSQL_ROOT_PASSWORD` specifically. The Secret stores
this value as `DB_PASSWORD` (named for the backend's perspective). Kubernetes maps one name to
the other — the application defines its own contract; Kubernetes bridges them.

**`MYSQL_DATABASE` from `backend-config.DB_NAME`**

The MySQL entrypoint creates this database on first start. The same value (`crud_app`) that the
backend reads as `DB_NAME` is what MySQL creates as the initial database.

**Two `volumeMounts`, two `volumes`**

Both must be under the same single `volumeMounts:` and `volumes:` key. Duplicate YAML keys
overwrite each other silently — only the last one survives. This was the source of the
`volumeMounts[0].name: Not found: "initdb"` error encountered during debugging.

**`mountPath: /var/lib/mysql`**

MySQL's compiled binary calls `open("/var/lib/mysql/...")` for all data operations. This path
is hardcoded in MySQL's source. If the PVC were mounted at `/database` instead, MySQL would
write to the container's ephemeral layer at `/var/lib/mysql` — creating the illusion of success
that only fails on the first restart.

**`mountPath: /docker-entrypoint-initdb.d`**

The MySQL Docker image's entrypoint script scans this directory for `.sql` and `.sh` files
during first initialization only. If the data directory (`/var/lib/mysql`) is already
populated, the directory is ignored — MySQL protects existing data from accidental re-initialization.

---

## MySQL Service

### Engineering Problem

Pods are ephemeral. When a Pod crashes and is recreated, its IP address changes. The backend
connects to MySQL using `DB_HOST=mysql`. This hostname must always resolve to a healthy MySQL
Pod regardless of Pod restarts.

A Service provides the stable network identity:

```
Backend Pod
    │
    │  mysql.prod.svc.cluster.local
    ▼
CoreDNS resolves → MySQL Service ClusterIP (10.98.205.79)
    │
    ▼
kube-proxy iptables rules
    │
    ▼
MySQL Pod (current IP, whatever it is)
```

### Manifest

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql
  namespace: prod
  labels:
    app: mysql
spec:
  selector:
    app: mysql
  ports:
    - name: mysql
      port: 3306
      targetPort: 3306
  type: ClusterIP
```

**`name: mysql`** — this becomes the DNS hostname. `DB_HOST: mysql` in the ConfigMap resolves
to this Service's ClusterIP. If the Service were named `database`, `DB_HOST` would need to be
`database`. The name must match the application's expected hostname.

**`type: ClusterIP`** — MySQL is an internal service. No external access is needed or desired.
ClusterIP makes it reachable only from within the cluster.

**`name: mysql` on the port** — naming ports makes them referenceable by NetworkPolicies,
ServiceMonitors (Prometheus), and Istio without relying on port numbers.

### Why the Selector Must Match the Deployment Labels

The Service selector `app: mysql` must exactly match the Pod labels set in the Deployment
template. The EndpointSlice Controller continuously queries the API Server for Pods matching
this selector and updates the Service's backend list automatically.

If labels mismatch:
```
Service selector:  app: database
Pod labels:        app: mysql
Result:            Endpoints: <none>
Backend receives:  ECONNREFUSED or ENOTFOUND
```

### Verification

```bash
kubectl apply -f Kubernetes/mysql/service.yaml
kubectl get endpoints -n prod
kubectl get endpointslices -n prod
```

Output:
```
NAME    ENDPOINTS         AGE
mysql   10.244.0.3:3306   111s
```

The EndpointSlice Controller automatically populated the Service endpoint with the MySQL Pod's
IP. No manual configuration.

---

## MySQL Deployment — Debugging Log

### Issue 1: YAML Structure Error

Symptom:
```
spec.template.spec.containers[0].volumeMounts[0].name: Not found: "initdb"
```

Cause: Two separate `volumeMounts:` keys in the YAML. In YAML, duplicate keys overwrite —
the second `volumeMounts:` replaced the first, leaving `initdb` unreferenced.

Fix: Consolidate into a single `volumeMounts:` list with both entries.

### Issue 2: Pod Stuck in Pending — Missing PVC

After deleting the MySQL Deployment and PVC to force re-initialization:

```bash
kubectl apply -f Kubernetes/mysql/deployment.yaml
kubectl get pods -n prod -w
→ mysql-... 0/1 Pending (never advances)
```

`kubectl describe pod`:
```
Events:
Warning FailedScheduling  persistentvolumeclaim "mysql-pvc" not found
```

Cause: The PVC was deleted. The Deployment references `mysql-pvc` in its volumes. The
Scheduler refuses to place the Pod on any node because a required volume is missing.

The Scheduler is behaving correctly — it refuses to start a container without all declared
dependencies available. This is not a failure; it is a safety mechanism.

Fix: Recreate the PVC first.

```bash
kubectl apply -f Kubernetes/mysql/pvc.yaml
```

The Scheduler immediately detected the PVC becoming available and scheduled the Pod
without any `kubectl apply` to the Deployment. The reconciliation loop was already
running — it simply needed the dependency to become available.

### Issue 3: MySQL One-Time Initialization

After the first MySQL Pod ran (without the `initdb` volume mount), the PVC was already
populated with MySQL data files. Subsequent runs of the MySQL container detected an
initialized data directory and skipped executing `/docker-entrypoint-initdb.d/init.sql`.

This is the MySQL entrypoint's protective behavior:
```
Is /var/lib/mysql empty?
  YES → run init scripts → create schema
  NO  → skip init → protect existing data
```

Fix: Delete the PVC (destroying all data), recreate it empty, and redeploy MySQL.
On first start with an empty PVC, MySQL executes `init.sql` and creates the `users` table.

### MySQL Initialization Confirmed

`kubectl logs -n prod deployment/mysql` showed:
```
[Entrypoint]: Initializing database files
[Entrypoint]: Creating database crud_app
[Entrypoint]: running /docker-entrypoint-initdb.d/init.sql
[Entrypoint]: MySQL init process done. Ready for start up.
```

Internal verification:
```bash
kubectl exec -it -n prod deployment/mysql -- sh
mysql -uroot -p
SHOW DATABASES;     → crud_app present
USE crud_app;
SHOW TABLES;        → users present
DESCRIBE users;     → id, name, email, password, role, is_active, created_at
```

---

## Backend Deployment

### Engineering Problem

The backend is stateless. It stores no data on its filesystem. Every Pod restart begins with
a clean Node.js process. There is no PVC, no volume, no StatefulSet requirement.

The backend's only external dependencies are:
- The MySQL Service (via DNS `mysql`) — for data persistence
- ConfigMap (non-sensitive config) — injected as environment variables
- Secret (credentials) — injected as environment variables

### Image Loading for Minikube

Kubernetes running inside Minikube cannot access images in the Mac's local Docker daemon.
The image must be explicitly loaded into Minikube's internal container runtime:

```bash
minikube image load backend:v2
minikube image ls | grep backend
→ docker.io/library/backend:v2
```

`imagePullPolicy: IfNotPresent` instructs the kubelet to use the locally cached image rather
than attempting to pull from Docker Hub. This is correct for development. Production uses
a registry (Docker Hub, ECR, GCR) and removes or changes this policy.

### Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: prod
  labels:
    app: backend
spec:
  replicas: 1
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
          image: backend:v2
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5000
          env:
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: backend-config
                  key: DB_HOST
            - name: DB_USER
              valueFrom:
                configMapKeyRef:
                  name: backend-config
                  key: DB_USER
            - name: DB_NAME
              valueFrom:
                configMapKeyRef:
                  name: backend-config
                  key: DB_NAME
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: DB_PASSWORD
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: backend-secret
                  key: JWT_SECRET
            - name: RESET_ADMIN_PASS
              value: "true"
```

**`DB_HOST` from ConfigMap** — resolves to `mysql` → CoreDNS → MySQL Service ClusterIP →
kube-proxy → MySQL Pod. Decouples the backend from the MySQL Pod's ephemeral IP.

**`RESET_ADMIN_PASS: "true"`** — `api/app.js` reads `process.env.RESET_ADMIN_PASS`. When
`"true"`, it resets the admin password on each startup. This is a development convenience.

**No `volumes` or `volumeMounts`** — the backend is stateless. Kubernetes starts a clean
container on every restart. No data needs to survive Pod termination.

---

## Backend Service

### Engineering Problem

The frontend (browser) sends API requests to the backend. The frontend's compiled JavaScript
bundle contains `REACT_APP_API=http://localhost:5000`. The browser is outside the Kubernetes
cluster network. A ClusterIP Service is not reachable from outside the cluster.

For the learning phase (before Ingress), NodePort exposes a port on every Worker Node,
making the Service reachable from the host machine.

### Service Type Decision

| Type | Reachability | Use case |
|---|---|---|
| ClusterIP | Inside cluster only | Service-to-service (MySQL, internal backend) |
| NodePort | Host machine via `nodePort` | Development, testing without Ingress |
| LoadBalancer | External via cloud LB | Production on cloud platforms |

MySQL uses `ClusterIP` — it must never be exposed externally.
Backend uses `NodePort` — to allow browser access during the learning phase.
This will be changed to `ClusterIP` when Ingress is introduced.

### Manifest

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: prod
  labels:
    app: backend
spec:
  selector:
    app: backend
  ports:
    - port: 5000
      targetPort: 5000
  type: NodePort
```

---

## Complete Stack Verification

### Final State After All Deployments

```bash
kubectl get all -n prod
```

```
NAME                           READY   STATUS    RESTARTS   AGE
pod/backend-5c65449546-4b4ld   1/1     Running   0          41s
pod/mysql-6686999677-7fr8d     1/1     Running   0          11m

NAME              TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)          AGE
service/backend   NodePort    10.x.x.x       <none>        5000:3xxxx/TCP
service/mysql     ClusterIP   10.98.205.79   <none>        3306/TCP

NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/backend   1/1     1            1
deployment.apps/mysql     1/1     1            1

NAME                                 DESIRED   CURRENT   READY
replicaset.apps/backend-5c65449546   1         1         1
replicaset.apps/mysql-6686999677     1         1         1
```

Every component is visible — Pods, Services, Deployments, ReplicaSets.
The hierarchy studied in Phase 5 is now observable in a running cluster.

### Backend Logs — Final Confirmed State

```bash
kubectl logs -n prod deployment/backend
```

```
🚀 Server running on http://0.0.0.0:5000
MySQL Connected
✅ Admin user created: admin@example.com / admin123
```

Three lines. Each proves one layer of the stack:
- **Server running** — image started, Express initialized, port 5000 bound
- **MySQL Connected** — `DB_HOST=mysql` resolved via CoreDNS → Service → Pod → successful auth
- **Admin user created** — `users` table exists, SQL INSERT succeeded

### Debugging the Rolling Restart Observation

During `kubectl rollout restart deployment backend -n prod`, the first `kubectl logs` returned
logs from the **old, terminating Pod** rather than the new one:

```
Found 2 pods, using pod/backend-6cd548795c-cv64r   ← old pod, still terminating
```

The log showed the previous `ER_NO_SUCH_TABLE` error — not because the fix failed, but because
Kubernetes was still in the process of replacing the Pod. After the old Pod terminated, the
command returned logs from the new Pod, which showed the successful output.

This is a normal rolling update observation. The Deployment maintains availability by keeping
the old Pod alive until the new one is Ready.

---

## Internal Container Verification

```bash
kubectl exec -it -n prod deployment/mysql -- sh
ls /var/lib/mysql
```

Output included `crud_app/` — the database directory created by `init.sql`. MySQL wrote
real data to the PVC-backed mount point.

```bash
env | grep MYSQL
```

Key outputs:
```
MYSQL_ROOT_PASSWORD=Anshuman         ← from Secret
MYSQL_DATABASE=crud_app              ← from ConfigMap
MYSQL_SERVICE_HOST=10.98.205.79      ← auto-injected by Kubernetes (legacy feature)
```

The `MYSQL_SERVICE_HOST` variable was not in the Deployment YAML — Kubernetes automatically
injects environment variables for every Service in the same namespace. This is a legacy
compatibility mechanism; modern applications use CoreDNS resolution instead.

---

## Deployment Architecture — Current State

```
prod namespace
│
├── backend-config (ConfigMap)
│   DB_HOST=mysql, DB_NAME=crud_app, DB_USER=root
│
├── backend-secret (Secret)
│   DB_PASSWORD=Anshuman, JWT_SECRET=devopsShackSuperSecretKey
│
├── mysql-initdb-config (ConfigMap)
│   init.sql → CREATE TABLE users (...)
│
├── mysql-pvc (PersistentVolumeClaim → 5Gi RWO)
│   └── auto-created PV (HostPath: /tmp/hostpath-provisioner/prod/mysql-pvc)
│
├── MySQL Deployment → ReplicaSet → Pod
│   ├── mounts mysql-pvc at /var/lib/mysql
│   ├── mounts mysql-initdb-config at /docker-entrypoint-initdb.d
│   ├── MYSQL_ROOT_PASSWORD from backend-secret
│   └── MYSQL_DATABASE from backend-config
│
├── mysql Service (ClusterIP: 10.98.205.79)
│   └── selector: app=mysql → routes to MySQL Pod
│
├── Backend Deployment → ReplicaSet → Pod
│   ├── image: backend:v2 (loaded via minikube image load)
│   ├── all env vars from backend-config + backend-secret
│   └── DB_HOST=mysql → resolves to mysql Service → MySQL Pod
│
└── backend Service (NodePort)
    └── selector: app=backend → routes to Backend Pod
```

---

## StatefulSet vs Deployment — Production Note

MySQL is deployed as a Deployment for learning. In production, databases use StatefulSets:

| Property | Deployment | StatefulSet |
|---|---|---|
| Pod identity | Random names (`mysql-abc123`) | Stable ordinal names (`mysql-0`) |
| Storage | Shared PVC across replicas | Dedicated PVC per replica (`data-mysql-0`) |
| Startup order | Parallel | Sequential (`mysql-0` before `mysql-1`) |
| DNS | Service ClusterIP | Per-Pod DNS (`mysql-0.mysql.namespace.svc`) |
| Use case | Stateless apps | Databases, distributed systems |

The Deployment used here is intentional for Phase 6. StatefulSets are introduced when the
project moves to production-grade MySQL configuration.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Minikube cluster setup and verification | Complete |
| Pre-existing system component investigation | Complete |
| Namespace — `prod` | Complete |
| ConfigMap — `backend-config` | Complete |
| Secret — `backend-secret` | Complete |
| PVC — `mysql-pvc` (5Gi RWO) | Complete |
| Dynamic PV provisioning via StorageClass | Complete |
| ConfigMap as mounted file — `mysql-initdb-config` | Complete |
| MySQL Deployment — Secret + ConfigMap + PVC | Complete |
| MySQL initialization via `/docker-entrypoint-initdb.d` | Complete |
| MySQL Service (ClusterIP) | Complete |
| Backend image loading into Minikube | Complete |
| Backend Deployment — ConfigMap + Secret injection | Complete |
| Backend Service (NodePort) | Complete |
| End-to-end stack verification — MySQL Connected + Admin created | Complete |
| Debugging: YAML structure error (duplicate keys) | Complete |
| Debugging: Pending Pod — missing PVC | Complete |
| Debugging: MySQL one-time initialization behavior | Complete |
| Debugging: Rolling restart — old Pod logs observed | Complete |

### Remaining — Phase 6 Continuation

| Topic | Status |
|---|---|
| Frontend Deployment | Pending |
| Frontend Service | Pending |
| End-to-end browser test (frontend → backend → MySQL) | Pending |
| Self-healing investigation (delete Pod, watch ReplicaSet) | Pending |
| Scaling exercise (`replicas: 3`) | Pending |
| Rolling update exercise (`backend:v1` → `backend:v2`) | Pending |
| Engineering retrospective | Pending |
