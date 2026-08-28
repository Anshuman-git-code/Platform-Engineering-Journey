# Repository Structure

## Top-Level Layout

```
docker-kubernetes-cicd-implementation/
├── api/                        Node.js + Express backend
├── client/                     React frontend
├── Kubernetes/                 All Kubernetes manifests (capital K — authoritative)
├── docs/                       Engineering documentation (public)
├── gitlab/                     GitLab CI/CD notes placeholder
├── helm/                       Helm charts (future — Phase 10)
├── terraform/                  Terraform IaC (future — Phase 11)
├── docker/                     Docker utilities placeholder
├── scripts/                    Operational scripts placeholder
├── .github/                    GitHub Actions placeholder
├── .kiro/                      Kiro workspace configuration
│   └── steering/               Steering files (auto-included in context)
├── docs/internal/              PRIVATE AI state (gitignored, never committed)
├── .gitlab-ci.yml              GitLab CI/CD pipeline definition
├── docker-compose.yaml         Local development stack
├── README.md                   Project overview
└── .gitignore                  Excludes secrets, artifacts, internal state
```

## Application Source

```
api/
├── app.js                      Express entry point, admin seeding
├── Dockerfile                  Single-stage node:22-alpine image
├── package.json                Production dependencies
├── controllers/
│   ├── authController.js       Login, register logic
│   └── userController.js       CRUD operations
├── middleware/
│   ├── auth.js                 JWT verification
│   └── role.js                 RBAC enforcement
├── models/
│   └── db.js                   MySQL single connection
└── routes/
    ├── authRoutes.js
    └── userRoutes.js

client/
├── Dockerfile                  Multi-stage build (node:22-alpine → nginx:alpine)
├── src/
│   ├── axios.js                Configured Axios instance (baseURL: /api)
│   ├── context/AuthContext.js  Global auth state
│   ├── pages/                  Login, Register, UserDashboard, NotFound
│   └── components/             Layout, UserForm, AnimatedBanner, InfoPopup
└── public/                     index.html, manifest.json
```

## Kubernetes Manifests

```
Kubernetes/
├── base/
│   └── namespace.yaml          prod namespace
├── mysql/
│   ├── configmap.yaml          (unused — mysql uses backend-config)
│   ├── initdb-configmap.yaml   SQL schema mounted at /docker-entrypoint-initdb.d
│   ├── pvc.yaml                5Gi ReadWriteOnce
│   ├── deployment.yaml         mysql:8, replicas:1, mounts PVC + initdb
│   └── service.yaml            ClusterIP :3306
├── backend/
│   ├── configmap.yaml          DB_HOST, DB_NAME, DB_USER
│   ├── secret.yaml             DB_PASSWORD, JWT_SECRET (stringData)
│   ├── deployment.yaml         backend:v2, replicas:1, env from CM+Secret
│   └── service.yaml            NodePort :5000
├── frontend/
│   ├── deployment.yaml         frontend:v4, replicas:3
│   └── service.yaml            NodePort :80
├── ingress/
│   └── ingress.yaml            crud.local: /→frontend, /api→backend
├── namespace/
│   └── namespace.yaml          (duplicate — authoritative copy in base/)
└── monitoring/
    ├── prometheus.yaml         placeholder stub
    └── grafana.yaml            placeholder stub
```

## Documentation

```
docs/
├── 00-project-overview.md
├── 01-codebase-investigation.md
├── 02-local-environment-verification.md
├── 03-containerization-foundations.md
├── 04-image-construction.md
├── 05-backend-dockerfile-analysis.md
├── 06-frontend-dockerfile-analysis.md
├── 07-docker-compose-analysis.md
├── 08-kubernetes-foundations.md
├── 09-kubernetes-deployment.md
├── 10-kubernetes-frontend-ingress.md
├── 11-gitlab-cicd.md
├── architecture.md
├── engineering-decisions.md
└── learning-journal.md
```

## Private AI State (gitignored)

```
docs/internal/
├── PROJECT_MEMORY.md           Stable long-term project knowledge
├── PROJECT_CONTEXT.md          Audit findings, constraints, decisions
├── AI_HANDOFF.md               Session handoff state
├── AI_STATE.json               Machine-readable phase/task state
└── NEXT_STEPS.md               Exact next task and recovery instructions
```

## Gitignored Items

- `node_modules/`
- `.env` files
- `client/build/`
- `.DS_Store`
- `3-Tier DevSecOps Project/` (reference project — read-only on disk)
- `docs/internal/` (private AI state)
- `.vscode/`, `.idea/`

## Critical Naming Note

The Kubernetes manifests directory is `Kubernetes/` (capital K). The `README.md` and some
documentation may reference lowercase `kubernetes/` — this is a documentation inconsistency
on case-insensitive macOS. The authoritative directory on disk is `Kubernetes/`.
