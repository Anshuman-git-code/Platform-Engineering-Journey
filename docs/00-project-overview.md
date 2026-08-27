# Project Overview

## Purpose

This repository documents the complete engineering journey of taking an unfamiliar three-tier application and progressively preparing it for production deployment using Docker, Kubernetes, and CI/CD.

The emphasis is not on writing configuration files.  
The emphasis is on engineering thinking — understanding a system before modifying it, making deliberate decisions, and verifying every step before moving forward.

---

## What This Repository Is

This is an engineering portfolio that demonstrates how a real application is analyzed, understood, modernized, containerized, orchestrated, and eventually deployed to production.

It is not a tutorial.  
It is not a collection of copy-pasted YAML.  
It is a record of real engineering work, including the thinking behind every decision.

---

## The Application

A three-tier web application consisting of:

| Tier | Technology | Responsibility |
|---|---|---|
| Presentation | React.js | UI, user interaction, HTTP requests, rendering |
| Application | Node.js + Express | Authentication, business logic, API endpoints, database communication |
| Data | MySQL | Persistent storage of user data |

The tiers are separated into independent layers. Each layer has a distinct responsibility and can be developed, tested, and deployed independently.

---

## Engineering Phases

| Phase | Title | Status |
|---|---|---|
| Phase 0 | Understanding an Unknown Codebase Before Infrastructure Modernization | ✅ Complete |
| Phase 1 | Docker Foundations | ✅ Complete |
| Phase 2A | Image Construction | ✅ Complete |
| Phase 2B | Backend Containerization | ✅ Complete |
| Phase 3 | Frontend Containerization | ✅ Complete |
| Phase 4 | Docker Compose | ✅ Complete |
| Phase 5 | Kubernetes Fundamentals | ✅ Complete |
| Phase 6 | Kubernetes Application Deployment | ✅ Complete |
| Phase 7 | Frontend on Kubernetes + NGINX Ingress | ✅ Complete |
| Phase 8 | GitLab CI/CD | 🚧 Phase 8A Complete |
| Phase 9 | Production Kubernetes Hardening | ⏳ |
| Phase 10 | Helm | ⏳ |
| Phase 11 | Terraform | ⏳ |
| Phase 12 | AWS EKS | ⏳ |
| Phase 13 | Production Ingress + TLS | ⏳ |
| Phase 14 | Monitoring — Prometheus + Grafana | ⏳ |
| Phase 15 | Notifications — Slack | ⏳ |

---

## Guiding Principle

Every phase of this project follows the same engineering discipline:

1. Understand the current state completely
2. Identify the problem to solve
3. Choose an approach and justify it
4. Implement
5. Verify the result

No infrastructure work begins until the layer beneath it is confirmed working.
