# Technology Stack

## Application Layer

### Frontend
- **React 19** — SPA framework
- **react-router-dom v7** — client-side routing
- **Axios** — HTTP client with JWT interceptor (`client/src/axios.js`)
- **Base URL pattern:** `process.env.REACT_APP_API || '/api'` (relative, works behind Ingress)
- **Build tool:** react-scripts (Webpack-based)
- **Production server:** Nginx (Alpine) — static file serving only, no Node.js at runtime

### Backend
- **Node.js + Express 4** — REST API server
- **mysql2** — MySQL driver (single `createConnection`, not pool — known production limitation)
- **bcryptjs** — password hashing (pure JS, no native bindings)
- **jsonwebtoken** — JWT signing/verification
- **cors, body-parser, dotenv** — middleware

### Database
- **MySQL 8** — relational database
- **Schema:** single `users` table with `id, name, email, password, role, is_active, created_at`
- **Initialization:** SQL via ConfigMap mounted at `/docker-entrypoint-initdb.d/`

## Containerization

### Backend Dockerfile (`api/Dockerfile`)
- Base: `node:22-alpine`
- Single-stage build
- `npm install --only=production`
- CMD exec form: `["node", "app.js"]`

### Frontend Dockerfile (`client/Dockerfile`)
- **Stage 1 (builder):** `node:22-alpine` — `npm ci`, `npm run build`
- **Stage 2 (runtime):** `nginx:alpine` — serves `/app/build` from `/usr/share/nginx/html`
- Supports `ARG REACT_APP_API` build argument for API URL embedding
- CMD: `["nginx", "-g", "daemon off;"]`

## Container Orchestration

### Local Development
- **Docker Compose** — `docker-compose.yaml`
- Services: `mysql`, `backend`, `frontend`
- MySQL password in Compose: `Aditya` (differs from Kubernetes: `Anshuman`)

### Kubernetes (Current — Minikube)
- **Minikube** on Apple Silicon Mac, Docker driver
- **Namespace:** `prod`
- **Ingress controller:** NGINX (Minikube addon)
- **Ingress host:** `crud.local`
- **Storage:** Minikube HostPath provisioner, default StorageClass
- **MySQL model:** Deployment (learning phase) — StatefulSet deferred to Phase 9

### Kubernetes Manifest Location
- All manifests: `Kubernetes/` (capital K)
- `Kubernetes/base/` — Namespace
- `Kubernetes/mysql/` — ConfigMap, initdb-ConfigMap, Secret (via backend-secret), PVC, Deployment, Service
- `Kubernetes/backend/` — ConfigMap, Secret, Deployment, Service
- `Kubernetes/frontend/` — Deployment, Service
- `Kubernetes/ingress/` — Ingress (crud.local → /=frontend, /api=backend)
- `Kubernetes/monitoring/` — placeholder stubs only

## CI/CD Platform

- **Platform:** GitLab CI/CD (replacing Jenkins from reference project)
- **Runner:** Self-hosted, Apple Silicon Mac, shell executor
- **Runner version:** 19.3.1
- **Runner tag:** `macos`
- **Pipeline file:** `.gitlab-ci.yml`
- **Current pipeline:** verification stage only (Phase 8A)

## Security Tools (Planned — Phase 8)

| Tool | Purpose | Installation |
|---|---|---|
| GitLeaks | Secret detection in source | `brew install gitleaks` |
| SonarQube | Static code analysis | `docker run sonarqube:community` |
| Trivy | FS and image vulnerability scanning | `brew install trivy` |

## Infrastructure as Code (Future)

- **Terraform** — AWS VPC, EKS, IAM (Phase 11)
- **Helm** — chart packaging for all K8s manifests (Phase 10)
- **Target cloud:** AWS (us-east-1)
- **Target cluster:** AWS EKS

## Image Registry

- **Docker Hub** — `anshuman0506/backend`, `anshuman0506/frontend`
- **Tag strategy:** `$CI_COMMIT_SHORT_SHA` (deterministic) + `:latest` (convenience)

## Monitoring (Future — Phase 14)

- **kube-prometheus-stack** via Helm (preferred over hand-written manifests)
- Prometheus, Grafana, kube-state-metrics, Node Exporter

## Notifications (Future — Phase 15)

- GitLab pipeline → Slack webhook integration
- Credential stored as masked GitLab CI variable: `SLACK_WEBHOOK_URL`
