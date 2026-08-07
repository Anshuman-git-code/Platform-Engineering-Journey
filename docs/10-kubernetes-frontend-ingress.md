# Phase 7 — Frontend on Kubernetes and Ingress

## Objective

Phase 7 completes the three-tier application on Kubernetes by adding the frontend tier and
connecting it to the backend through a production-grade networking layer. Two distinct
engineering problems are solved:

1. Deploy the React frontend as a containerized workload inside the cluster
2. Expose the complete application through a single, stable entry point using an Ingress
   controller, eliminating the browser's dependency on Kubernetes-internal service names

By the end of this phase, the full request chain is operational:

```
Browser (http://crud.local)
        │
        ▼
NGINX Ingress Controller
        │
        ├── path: /    → Frontend Service → Frontend Pods (Nginx + React)
        └── path: /api → Backend Service  → Backend Pod
                                                │
                                                ▼
                                         MySQL Service
                                                │
                                                ▼
                                           MySQL Pod
                                                │
                                                ▼
                                      PersistentVolume
```

---

## Why a Frontend Deployment Is Different from Backend and MySQL

The frontend container does not run a persistent server process in the traditional sense.
It runs Nginx, which serves pre-compiled static files — HTML, CSS, and JavaScript bundles.

```
Backend:                               Frontend:
Node.js starts                         Nginx starts
Reads config at runtime                Reads pre-compiled static files
Connects to MySQL                      No runtime connections
Long-lived process with state          Stateless file server

→ Needs ConfigMap, Secret             → Needs neither
→ Single replica (MySQL constraint)   → Can scale horizontally (3 replicas)
→ No horizontal scaling concern       → Completely stateless
```

Because the React application compiles environment variables at build time — not at container
start time — the backend URL must be embedded in the JavaScript bundle during `docker build`,
not injected through Kubernetes `env:` fields.

---

## React Build-Time vs Runtime Configuration

This distinction is the most important engineering concept in Phase 7.

```
Backend (Node.js):                     Frontend (React):
process.env.DB_HOST                    process.env.REACT_APP_API
  │                                      │
  ▼                                      ▼
Read at container start              Read at npm run build
  │                                      │
  ▼                                      ▼
Kubernetes env: works directly       Kubernetes env: has NO EFFECT on
                                     already-built bundles
```

When React runs `npm run build`, Webpack replaces every `process.env.REACT_APP_API` reference
with a literal string hardcoded into the generated JavaScript. After the build, Nginx simply
serves static files — it does not interpret environment variables. This means:

- `env:` in a Kubernetes Deployment has no effect on a pre-built React image
- The environment variable must be provided as a Docker `--build-arg` at image build time
- Changing the backend URL requires rebuilding the image

---

## Axios Configuration — The Correct Pattern

### Initial State (v1/v2 images)

```javascript
baseURL: process.env.REACT_APP_API || 'http://localhost:5000'
```

`http://localhost:5000` is a browser-side fallback. In a Kubernetes cluster with an Ingress,
the browser should never communicate directly with `backend:5000`. The hostname `backend` only
resolves inside the Kubernetes cluster network — not in the user's browser.

### Intermediate State (v2 image — wrong but instructive)

After adding `ARG REACT_APP_API` / `ENV REACT_APP_API` to the Dockerfile, the image was built
without passing the build argument:

```bash
docker build -t frontend:v2 ./client   # no --build-arg
```

Result: `REACT_APP_API` was empty. React used the fallback `http://localhost:5000`.
The bundle compiled with a URL the browser could reach locally but not through Ingress.

Verification inside a running Pod:
```bash
kubectl exec -it -n prod deployment/frontend -- sh
grep -R "backend:5000" /usr/share/nginx/html   # found: confirmed v2 had wrong URL
```

### v3 Image — Correct Build, Wrong Call Paths

`client/src/axios.js` was updated to:

```javascript
baseURL: process.env.REACT_APP_API || '/api'
```

Image built with `baseURL` defaulting to `/api`. The bundle now contained the correct relative
base URL. However, call sites in `AuthContext.js` and `UserDashboard.js` still used full paths:

```javascript
axios.post('/api/auth/register', ...)   // became: /api/api/auth/register ← 404
axios.get('/api/users')                 // became: /api/api/users         ← 404
```

The duplicate `/api` produced a path the Ingress and backend had no route for.

### v4 Image — Final Correct Configuration

`client/src/axios.js` (final):

```javascript
import axios from 'axios';

const instance = axios.create({
  baseURL: process.env.REACT_APP_API || '/api',
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

export default instance;
```

`client/src/context/AuthContext.js` (updated call paths):

```javascript
const res = await axios.post('/auth/login', { email, password });
await axios.post('/auth/register', { name, email, password });
```

`client/src/pages/UserDashboard.js` (updated call paths):

```javascript
.get('/users')
.post('/users', userData)
.put(`/users/${id}`, userData)
.delete(`/users/${id}`)
```

**The rule:** When `baseURL` is `/api`, individual request paths must not start with `/api`.
The Axios instance prepends the base automatically. The complete URL that reaches the browser:

```
baseURL="/api"  +  path="/auth/register"  =  /api/auth/register  ✅
baseURL="/api"  +  path="/api/auth/register"  =  /api/api/auth/register  ❌
```

---

## client/Dockerfile — Updated for Build Arguments

The Dockerfile was modified to accept the backend URL as a build argument:

```dockerfile
# Stage 1: Build React App
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG REACT_APP_API
ENV REACT_APP_API=$REACT_APP_API

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

**`ARG REACT_APP_API`** — declares a Docker build argument. Accepts a value passed via
`--build-arg REACT_APP_API=<value>` at build time.

**`ENV REACT_APP_API=$REACT_APP_API`** — promotes the build argument into an environment
variable so Webpack can read it during `npm run build`. Without this line, Docker ignores
the `--build-arg` entirely.

**Why this position matters:** `ARG` and `ENV` are placed after `COPY . .` so the npm ci
cache layer remains valid. Changing the API URL only invalidates layers from `ARG` onward —
the expensive dependency installation is unaffected.

---

## Frontend Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: prod
  labels:
    app: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: frontend:v4
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
```

**`replicas: 3`** — the frontend is completely stateless. Three replicas provide availability
across node failures without any storage or identity constraints. Unlike MySQL (single writer
with RWO PVC), the frontend can scale arbitrarily because each Pod serves the same static files
independently.

**No `env:`, `volumeMounts:`, or `volumes:`** — the frontend has no runtime configuration,
no persistent storage, no database connections. The image already contains everything needed.

**`containerPort: 80`** — Nginx listens on port 80 inside the container. This is the port
declared in the Dockerfile via `EXPOSE 80`.

**`imagePullPolicy: IfNotPresent`** — uses the locally loaded Minikube image rather than
attempting a Docker Hub pull. Required because the image was loaded via `minikube image load`.

---

## Frontend Service Manifest

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: prod
  labels:
    app: frontend
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  type: NodePort
```

**`type: NodePort`** — exposes the frontend on a high-numbered port on every cluster node.
This allows browser access during the learning phase before Ingress is fully routing traffic.
Once Ingress is in place, the browser uses `crud.local` and the NodePort becomes unused for
normal traffic.

In production, this would be `ClusterIP` — the frontend would only be accessible through
the Ingress, never directly.

---

## The Ingress Problem — Why the Browser Cannot Resolve `backend`

After deploying the frontend with `baseURL: 'http://backend:5000'`, clicking Register
produced:

```
POST http://backend:5000/api/auth/register
net::ERR_NAME_NOT_RESOLVED
```

The engineering explanation:

```
Kubernetes cluster network (private):     User's Mac network (public):
                                               │
mysql  → 10.98.205.79                          │
backend → 10.96.81.146                         │
frontend → 10.109.147.91                       │
                                               │
These DNS names only resolve inside      Mac DNS resolver:
the cluster via CoreDNS                  google.com ✔
                                         github.com ✔
                                         backend    ✘ (unknown)
```

The frontend Pods run inside the cluster and can resolve `backend` via CoreDNS. The browser
runs on the Mac outside the cluster and cannot. The request to `http://backend:5000` never
reaches Kubernetes — the Mac's DNS resolver rejects it before any network packet is sent.

This is not a misconfiguration. It is the expected behavior. Kubernetes internal DNS is
intentionally not exposed to external networks. The solution is Ingress.

---

## Why the NodePort URL Changes Every Time on macOS

The Minikube Docker driver on macOS creates an SSH tunnel from a randomly assigned local port
to the cluster NodePort on each `minikube service --url` invocation. Each `Ctrl+C` destroys
the tunnel. The next invocation assigns a different local port. This is a macOS-specific
behavior caused by the Docker VM network isolation.

This is the operational reason Ingress is essential for macOS Minikube development:

```
Without Ingress (NodePort + tunnel):
  Each run:  http://127.0.0.1:63991  (random, changes)
  Next run:  http://127.0.0.1:52268  (different random port)

With Ingress + /etc/hosts:
  Always:    http://crud.local        (stable, predictable)
```

---

## Ingress Controller Installation

An Ingress resource is YAML metadata. It has no effect without a controller that reads it
and programs actual network routing. The controller is a separate workload installed into
the cluster.

```bash
minikube addons enable ingress
```

This installs the NGINX Ingress Controller into the `ingress-nginx` namespace:

```
kubectl get pods -n ingress-nginx

NAME                                            READY
ingress-nginx-controller-56d7c84fd4-pk2q5       1/1 Running
ingress-nginx-admission-create-9wsnn             Completed
ingress-nginx-admission-patch-gfl87              Completed
```

The two `Completed` Pods are one-time Jobs that configure TLS admission webhooks. The
`Running` Pod is the controller — the NGINX process that continuously watches the API Server
for Ingress resources and programs its routing rules accordingly.

**Why minikube tunnel is required on macOS:**

```bash
minikube tunnel   # must remain running
```

The Ingress Controller Service requires a `LoadBalancer` type to receive an external IP.
On cloud providers (AWS, GCP), the cloud control plane provisions a real load balancer.
On Minikube with the Docker driver, `minikube tunnel` creates a process that routes traffic
from `127.0.0.1` into the cluster, satisfying the LoadBalancer requirement locally.

---

## Ingress Manifest — Line-by-Line Engineering Analysis

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: crud-app-ingress
  namespace: prod
spec:
  ingressClassName: nginx
  rules:
    - host: crud.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 5000
```

### apiVersion: networking.k8s.io/v1

Ingress belongs to the `networking.k8s.io` API group, not the core `v1` group. The `v1` suffix
indicates the stable, production-ready version. Earlier Kubernetes versions used
`extensions/v1beta1` or `networking.k8s.io/v1beta1` — both deprecated.

### kind: Ingress

Declares this as an Ingress object. The Ingress Controller watches for objects of this kind
and translates them into NGINX routing configuration.

### metadata.name: crud-app-ingress

Unique identifier for this Ingress resource within the `prod` namespace. Used in
`kubectl describe ingress crud-app-ingress -n prod`.

### metadata.namespace: prod

Places the Ingress in the `prod` namespace alongside the Services it routes to. An Ingress
can only route to Services in the same namespace.

### spec.ingressClassName: nginx

Tells Kubernetes which Ingress Controller should handle this resource. A cluster may have
multiple Ingress Controllers (NGINX, Traefik, AWS ALB, etc.). `ingressClassName: nginx`
targets the NGINX Ingress Controller specifically. Without this field, the resource may be
ignored if there is no default controller configured.

### spec.rules[0].host: crud.local

Defines the virtual hostname this rule applies to. The Ingress Controller only processes
requests where the HTTP `Host` header matches `crud.local`. Requests to other hostnames are
either forwarded to a default backend or dropped.

This requires `/etc/hosts` on the developer's machine to map `crud.local` to the local
tunnel IP:

```
127.0.0.1    crud.local
```

In production, this would be a real DNS record pointing to the load balancer's IP.

### spec.rules[0].http.paths[0].path: /  pathType: Prefix

Any request beginning with `/` is matched by this rule. `pathType: Prefix` means the path
is a prefix match — `/`, `/login`, `/dashboard`, `/anything` all match.

The order of paths matters. The Ingress Controller evaluates paths in order from most
specific to least specific. `/api` is more specific than `/`, so it is evaluated first.
Requests to `/api/...` are routed to the backend. All other requests fall through to the `/`
rule and reach the frontend.

### backend.service.name: frontend, port.number: 80

Routes matched requests to the `frontend` Service on port 80. The frontend Service selector
(`app: frontend`) routes traffic to the three Frontend Pods. Each Pod runs Nginx, which
serves the React static files.

### spec.rules[0].http.paths[1].path: /api  pathType: Prefix

Any request beginning with `/api` is routed to the backend Service. This includes:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users`
- `PUT /api/users/:id`

The Ingress Controller forwards the original path unchanged to the backend. Express routes
are defined as `/api/auth/*` and `/api/users/*`, so the paths match directly.

### backend.service.name: backend, port.number: 5000

Routes `/api` requests to the `backend` Service on port 5000. The backend Service selector
(`app: backend`) routes to the Backend Pod running Express.

### Why the Browser Never Needs to Know About `backend`

```
Without Ingress:
Browser → POST http://backend:5000/api/auth/register → ERR_NAME_NOT_RESOLVED
(Mac DNS cannot resolve "backend")

With Ingress:
Browser → POST http://crud.local/api/auth/register → Ingress receives it
                                                       → routes /api to backend Service
                                                       → backend Service → Backend Pod
(Browser only knows "crud.local" — a real resolvable hostname)
```

---

## Verification — Ingress Working

```bash
kubectl get ingress -n prod
```

```
NAME               CLASS   HOSTS        ADDRESS        PORTS
crud-app-ingress   nginx   crud.local   192.168.49.2   80
```

`ADDRESS: 192.168.49.2` — the Minikube node IP where the Ingress Controller is listening.
With `minikube tunnel` running, this is accessible via `127.0.0.1` on the Mac.

```bash
kubectl describe ingress crud-app-ingress -n prod
```

```
Rules:
Host        Path  Backends
----        ----  --------
crud.local
            /     frontend:80   (10.244.0.10:80, 10.244.0.11:80, 10.244.0.9:80)
            /api  backend:5000  (10.244.0.8:5000)
```

The Ingress Controller has already discovered all three Frontend Pod endpoints and the single
Backend Pod endpoint. This discovery uses the same EndpointSlice mechanism as Services —
the controller watches label selectors and maintains up-to-date backend lists automatically.

---

## Image Build History

| Version | baseURL | Call paths | API URL in bundle | Result |
|---|---|---|---|---|
| `v1` | `http://localhost:5000` | `/api/auth/login` | `http://localhost:5000` | Works locally, fails in K8s |
| `v2` | `http://backend:5000` | `/api/auth/login` | `http://backend:5000` | ERR_NAME_NOT_RESOLVED |
| `v3` | `/api` (default) | `/api/auth/login` | `/api` | 404 — duplicate `/api` prefix |
| `v4` | `/api` (default) | `/auth/login` | `/api` | ✅ Working |

---

## Debugging Sessions

### Session 1 — ERR_NAME_NOT_RESOLVED

**Symptom:** `POST http://backend:5000/api/auth/register net::ERR_NAME_NOT_RESOLVED`

**Root cause:** The React bundle compiled with `baseURL: 'http://backend:5000'`. The browser
running on the Mac attempted to resolve `backend` through the Mac's DNS resolver. `backend`
is a Kubernetes internal Service name that only resolves inside the cluster via CoreDNS.
The Mac's DNS has no knowledge of it.

**Lesson:** Applications behind an Ingress should use relative paths (`/api`) as the base URL,
not internal Service hostnames. The browser should only communicate with the Ingress hostname.

### Session 2 — HTTP 404 (Duplicate /api prefix)

**Symptom:** `POST http://crud.local/api/api/auth/register 404 (Not Found)`

**Root cause:** `baseURL` was correctly set to `/api`, but call sites still used full paths
starting with `/api/`. Axios prepends `baseURL` to every request path, producing double prefix.

**Fix:** All call sites updated from `/api/auth/login` to `/auth/login`, etc.

### Session 3 — HTTP 500 (Stale MySQL Connection)

**Symptom:** `POST http://crud.local/api/auth/register 500 (Internal Server Error)`
Backend log: `Can't add new command when connection is in closed state`

**Root cause:** The MySQL Pod had restarted (RESTARTS: 1). The backend used
`mysql.createConnection()` — a single persistent TCP connection. When MySQL restarted, that
connection became invalid. The backend continued using the dead connection handle. All
subsequent queries failed.

**Fix:** `kubectl rollout restart deployment backend -n prod` — the backend created a new
TCP connection to MySQL and all operations succeeded.

**Engineering lesson:** `mysql.createConnection()` creates one non-reconnecting connection.
When the upstream database restarts, the connection dies permanently. Production applications
use `mysql.createPool()`, which manages a pool of connections, acquires new ones on demand,
and handles dropped connections gracefully. This is a production improvement identified and
deferred to the Production Engineering phase.

---

## Complete Application Verification

After all fixes, the following was confirmed working:

```bash
kubectl get pods -n prod
```

```
backend-f54fc54c4-9s4ll     1/1 Running   0   (fresh after rollout restart)
frontend-7f9488fc96-b6c9z   1/1 Running   0
frontend-7f9488fc96-hs6fb   1/1 Running   0
frontend-7f9488fc96-pgw69   1/1 Running   0
mysql-6686999677-7fr8d      1/1 Running   1   (1 restart earlier)
```

Browser network tab at `http://crud.local`:

```
register   201   POST http://crud.local/api/auth/register   216ms
login      200   POST http://crud.local/api/auth/login      236ms
users      200   GET  http://crud.local/api/users            35ms
```

Backend logs:

```
🚀 Server running on http://0.0.0.0:5000
MySQL Connected
✅ Admin user created: admin@example.com / admin123
```

---

## Rolling Update History — Visible in kubectl describe

The Deployment revision history from `kubectl describe deployment frontend -n prod` showed:

```
OldReplicaSets: frontend-7455dd5b58 (0/0)  ← v1 image
                frontend-56cf4ddb4c (0/0)  ← v3 image
NewReplicaSet:  frontend-7f9488fc96 (3/3)  ← v4 image
```

Three ReplicaSets, each corresponding to one image version. The rolling update events:

```
Scaled up   frontend-56cf4ddb4c from 0 to 1  (v3 replacing v1)
Scaled down frontend-7455dd5b58 from 3 to 2
...
Scaled up   frontend-7f9488fc96 from 0 to 1  (v4 replacing v3)
Scaled down frontend-56cf4ddb4c from 3 to 2
...
```

This is the same rolling update mechanism studied in Phase 5 — each Deployment update
creates a new ReplicaSet rather than modifying the existing one, preserving the ability to
roll back instantly by scaling the previous ReplicaSet back up.

---

## /etc/hosts Configuration

The final `/etc/hosts` entry required on the developer's Mac:

```
127.0.0.1    crud.local
```

This maps the stable hostname to the local tunnel IP created by `minikube tunnel`. All browser
requests to `http://crud.local` route through the tunnel into the Ingress Controller.

In production, `crud.local` would be replaced with a real domain name registered in a public
DNS provider, pointing to the load balancer IP provisioned by the cloud platform.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| React build-time vs runtime environment variable behavior | Complete |
| Dockerfile `ARG` / `ENV` for build arguments | Complete |
| Axios `baseURL` pattern for Ingress-aware frontend | Complete |
| Frontend image versions — v1 through v4 | Complete |
| Frontend Deployment (3 replicas, stateless, no PVC) | Complete |
| Frontend Service (NodePort) | Complete |
| Why NodePort URL changes on macOS Docker driver | Complete |
| Ingress Controller installation via Minikube addon | Complete |
| `minikube tunnel` requirement on macOS | Complete |
| Ingress manifest — line-by-line analysis | Complete |
| `ingressClassName: nginx` | Complete |
| `host: crud.local` — virtual hostname routing | Complete |
| Path-based routing: `/` → frontend, `/api` → backend | Complete |
| `pathType: Prefix` behavior and path evaluation order | Complete |
| `/etc/hosts` local DNS configuration | Complete |
| Debugging: ERR_NAME_NOT_RESOLVED — internal DNS not externally accessible | Complete |
| Debugging: 404 — duplicate `/api` prefix | Complete |
| Debugging: 500 — stale MySQL connection after Pod restart | Complete |
| Rolling update history visible in `kubectl describe` | Complete |
| End-to-end verification — register, login, users API | Complete |

### Phase 7 Status: Complete

The complete three-tier application is running on Kubernetes:

```
Browser (http://crud.local)
        │
        ▼  minikube tunnel
NGINX Ingress Controller (crud.local)
        │
        ├── /    → Frontend Service → 3 Frontend Pods (Nginx → React)
        └── /api → Backend Service  → Backend Pod (Express)
                                            │
                                            ▼  DB_HOST=mysql (CoreDNS)
                                     MySQL Service (ClusterIP)
                                            │
                                            ▼
                                        MySQL Pod
                                            │
                                            ▼
                                    PersistentVolume (5Gi)
```

**Updated Roadmap:**

| Phase | Topic | Status |
|---|---|---|
| Phase 0 | Engineering Investigation | ✅ |
| Phase 1 | Docker Foundations | ✅ |
| Phase 2 | Backend Containerization | ✅ |
| Phase 3 | Frontend Containerization | ✅ |
| Phase 4 | Docker Compose | ✅ |
| Phase 5 | Kubernetes Fundamentals | ✅ |
| Phase 6 | Backend on Kubernetes | ✅ |
| Phase 7 | Frontend + Ingress | ✅ |
| Phase 8 | CI/CD Pipeline | ➡️ Next |
| Future | Production Engineering | ⏳ |
