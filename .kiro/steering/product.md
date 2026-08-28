# Product Overview

## Project Identity

**Platform Engineering Journey**
Owner: Anshuman Mohapatra — Cloud & DevOps Engineer

## What This Project Is

A production-oriented engineering portfolio that documents the complete journey of taking
an unfamiliar three-tier web application and progressively containerizing, orchestrating,
securing, and deploying it to production using Docker, Kubernetes, and CI/CD.

This is not a tutorial. It is an engineering journal with real implementation, real bugs,
real debugging, and real engineering decisions — documented for portfolio, interview, and
knowledge retention purposes.

## The Application

A three-tier user management web application:

| Tier | Technology | Role |
|---|---|---|
| Presentation | React.js + Nginx | SPA frontend, JWT auth, user management UI |
| Application | Node.js + Express | REST API, JWT auth, RBAC, CRUD operations |
| Data | MySQL 8 | Persistent user storage with schema initialization |

### Key Application Features
- User registration and login with bcrypt password hashing
- JWT-based stateless authentication (1-hour expiry)
- Role-based access control: `admin` (full CRUD) and `viewer` (read-only)
- Admin user auto-seeded on startup via `initAdminUser()`
- Default credentials: `admin@example.com` / `admin123`

## Repository Strategy

| Remote | Purpose |
|---|---|
| `origin` → GitHub | Public portfolio, engineering documentation |
| `gitlab` → GitLab | CI/CD execution platform, pipeline source of truth |
| Docker Hub | Container image registry (`anshuman0506/backend`, `anshuman0506/frontend`) |

## Current Deployment Environment

- **Local development:** Docker Compose
- **Current Kubernetes:** Minikube (local, Apple Silicon Mac)
- **Target production:** AWS EKS (future phases)
- **Current ingress host:** `crud.local` (Minikube + `/etc/hosts`)
- **Kubernetes namespace:** `prod`

## Completed Engineering Phases

| Phase | Topic | Status |
|---|---|---|
| 0 | Engineering Investigation | ✅ Complete |
| 1 | Docker Foundations | ✅ Complete |
| 2A | Image Construction | ✅ Complete |
| 2B | Backend Containerization | ✅ Complete |
| 3 | Frontend Containerization | ✅ Complete |
| 4 | Docker Compose | ✅ Complete |
| 5 | Kubernetes Fundamentals | ✅ Complete |
| 6 | Kubernetes Application Deployment | ✅ Complete |
| 7 | Frontend + Ingress + End-to-End | ✅ Complete |
| 8 | GitLab CI/CD | 🚧 Phase 8A Complete |

## Remaining Phases

Phase 8 (CI/CD) → Phase 9 (Production K8s Hardening) → Phase 10 (Helm) →
Phase 11 (Terraform) → Phase 12 (AWS EKS) → Phase 13 (Ingress + TLS) →
Phase 14 (Monitoring) → Phase 15 (Notifications) → Final Documentation
