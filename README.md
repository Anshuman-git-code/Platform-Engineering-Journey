# Platform Engineering Journey

**Anshuman Mohapatra** — Cloud & DevOps Engineer

A production-oriented engineering portfolio that documents the complete journey of taking an unfamiliar three-tier application and progressively containerizing, orchestrating, and deploying it to production using Docker, Kubernetes, and CI/CD.

This is not a tutorial. It is an engineering journal — every phase documents the problem, the investigation, the decisions made, and the verified results.

---

## Application

A three-tier MERN-style web application:

| Tier | Technology | Role |
|---|---|---|
| Presentation | React.js + Nginx | UI, static file serving |
| Application | Node.js + Express | REST API, authentication, business logic |
| Data | MySQL | Persistent user data |

---

## Repository Structure

```
├── api/                    Node.js backend source + Dockerfile
├── client/                 React frontend source + Dockerfile
│
├── Kubernetes/             All Kubernetes manifests
│   ├── base/               Namespace definitions
│   ├── mysql/              MySQL: ConfigMaps, PVC, Deployment, Service
│   ├── backend/            Backend: Deployment, Service, ConfigMap, Secret
│   ├── frontend/           Frontend: Deployment, Service
│   ├── ingress/            NGINX Ingress rules (crud.local routing)
│   └── monitoring/         Prometheus, Grafana (future)
│
├── gitlab/                 GitLab CI/CD placeholder
├── terraform/              Infrastructure-as-Code (AWS EKS — future)
├── helm/                   Helm charts (future)
├── docker/                 Additional Docker utilities
├── scripts/                Operational shell scripts
├── .github/                GitHub Actions workflows
├── docs/                   Engineering documentation
├── .gitlab-ci.yml          GitLab CI/CD pipeline definition
└── docker-compose.yaml     Local development stack
```

---

## Engineering Phases

| Phase | Topic | Status |
|---|---|---|
| Phase 0 | Engineering Investigation — codebase analysis, local verification | ✅ |
| Phase 1 | Docker Foundations — architecture, images, containers, networking | ✅ |
| Phase 2A | Image Construction — layers, cache, build context | ✅ |
| Phase 2B | Backend Containerization — Dockerfile analysis, runtime debugging | ✅ |
| Phase 3 | Frontend Containerization — multi-stage builds, Nginx, npm ci | ✅ |
| Phase 4 | Docker Compose — multi-container orchestration, DNS, volumes | ✅ |
| Phase 5 | Kubernetes Foundations — cluster architecture, all core components | ✅ |
| Phase 6 | Kubernetes Deployment — Namespace, ConfigMap, Secret, PVC, MySQL, Backend | ✅ |
| Phase 7 | Frontend on Kubernetes + NGINX Ingress + End-to-End Verification | ✅ |
| Phase 8 | GitLab CI/CD — Runner setup, pipeline foundation | 🚧 Phase 8A Complete |
| Phase 9 | Production Kubernetes Hardening — probes, resource limits, rollback | ⏳ |
| Phase 10 | Helm — chart packaging | ⏳ |
| Phase 11 | Terraform — AWS infrastructure | ⏳ |
| Phase 12 | AWS EKS — production cluster | ⏳ |
| Phase 13 | Production Ingress + TLS | ⏳ |
| Phase 14 | Monitoring — Prometheus + Grafana | ⏳ |
| Phase 15 | Notifications — Slack integration | ⏳ |

---

## CI/CD

The project uses **GitLab CI/CD** with a self-hosted runner on Apple Silicon macOS.

```
git push → gitlab main
        │
        ▼
GitLab Pipeline
        │
        ▼
Self-hosted Runner (Mac)
        │
        ├── Docker (build, scan, push)
        ├── kubectl (deploy)
        └── Minikube (local cluster)
```

The pipeline will implement the same DevSecOps responsibilities as the reference project:
GitLeaks → SonarQube → Trivy FS → Docker Build → Trivy Image → Docker Push → K8s Deploy → Verify

Current pipeline status: **Phase 8A — Runner verification** ✅

See `.gitlab-ci.yml` for the current pipeline definition.

---

## Documentation

All engineering documentation lives in `docs/`. Each file covers one phase:

- `00-project-overview.md` — project purpose and roadmap
- `01-codebase-investigation.md` — technology identification methodology
- `02-local-environment-verification.md` — baseline verification
- `03-containerization-foundations.md` — Phase 1 Docker fundamentals
- `04-image-construction.md` — Phase 2A image layers and cache
- `05-backend-dockerfile-analysis.md` — Phase 2B complete backend analysis
- `06-frontend-dockerfile-analysis.md` — Phase 3 multi-stage build analysis
- `07-docker-compose-analysis.md` — Phase 4 Compose line-by-line analysis
- `08-kubernetes-foundations.md` — Phase 5 complete K8s architecture
- `09-kubernetes-deployment.md` — Phase 6 Deployment manifests and debugging
- `10-kubernetes-frontend-ingress.md` — Phase 7 Frontend, Ingress, end-to-end
- `11-gitlab-cicd.md` — Phase 8 GitLab CI/CD foundation
- `architecture.md` — application architecture reference
- `engineering-decisions.md` — all engineering decisions with reasoning
- `learning-journal.md` — conceptual evolution across all phases

---

## Local Development

```bash
# Start the complete three-tier application locally
docker compose up

# Access
# Frontend: http://localhost:3000
# Backend:  http://localhost:5000
# MySQL:    localhost:3306

# Login
# admin@example.com / admin123
```

---

## Kubernetes (Minikube)

```bash
# Prerequisites
minikube start
minikube addons enable ingress
minikube tunnel   # keep running in separate terminal

# Add to /etc/hosts
echo "127.0.0.1 crud.local" | sudo tee -a /etc/hosts

# Apply the complete stack (in dependency order)
kubectl apply -f Kubernetes/base/namespace.yaml
kubectl apply -f Kubernetes/mysql/
kubectl apply -f Kubernetes/backend/
kubectl apply -f Kubernetes/frontend/
kubectl apply -f Kubernetes/ingress/

# Verify
kubectl get all -n prod

# Access
# http://crud.local  (via minikube tunnel)
```
