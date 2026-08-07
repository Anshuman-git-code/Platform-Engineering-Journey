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
├── kubernetes/             All Kubernetes manifests
│   ├── base/               Namespace definitions
│   ├── mysql/              MySQL: Secret, ConfigMap, PVC, Deployment, Service
│   ├── backend/            Backend: Deployment, Service
│   ├── frontend/           Frontend: Deployment, Service
│   ├── ingress/            Ingress rules
│   └── monitoring/         Prometheus, Grafana
│
├── terraform/              Infrastructure-as-Code (AWS EKS)
├── helm/                   Helm charts
├── jenkins/                CI/CD pipeline definitions
├── docker/                 Additional Docker utilities
├── scripts/                Operational shell scripts
├── .github/                GitHub Actions workflows
├── docs/                   Engineering documentation
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
| Phase 6 | Kubernetes Deployment — manifests, Secrets, ConfigMaps | 🚧 |
| Phase 7 | Frontend on Kubernetes | ⏳ |
| Phase 8 | CI/CD Pipeline — Jenkins | ⏳ |
| Future | Terraform, AWS EKS, Helm, Ingress, HPA, Monitoring | ⏳ |

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
- `09-kubernetes-deployment.md` — Phase 6 Deployment manifests
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

## Kubernetes Quick Reference

```bash
# Apply the complete stack (in dependency order)
kubectl apply -f kubernetes/base/namespace.yaml
kubectl apply -f kubernetes/mysql/
kubectl apply -f kubernetes/backend/
kubectl apply -f kubernetes/frontend/

# Verify
kubectl get all -n prod

# Logs
kubectl logs -n prod deployment/backend
kubectl logs -n prod deployment/mysql
```
