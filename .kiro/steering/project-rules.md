# Project Rules

## Absolute Constraints

### Never Do
- Commit or push `docs/internal/` — private AI state only
- Commit or push the reference project (`3-Tier DevSecOps Project/`)
- Expose secrets, tokens, or credentials in any file, commit, or log
- Reintroduce Jenkins or GitHub Actions as the CI/CD platform
- Reuse or reference the compromised GitHub PAT (`ghp_HkiyGY...`) — treat as revoked
- Embed credentials directly in Git remote URLs
- Perform `git add .` blindly — always review staged files first
- Push to GitHub until `origin` remote is verified clean and credential is rotated
- Create AWS resources without explicit human cost acknowledgment and approval
- Destroy infrastructure automatically without explicit human authorization
- Copy the reference project's credentials, .git directory, or secrets
- Silently replace working implementations (e.g., MySQL Deployment → StatefulSet without documentation)

### Always Do
- Verify `git status` and `git diff` before every commit
- Confirm no secrets are staged before committing
- Confirm `docs/internal/` and `3-Tier DevSecOps Project` are not staged
- Update `docs/internal/` state files after every completed logical task
- Document real bugs with: symptom → evidence → root cause → fix → verification → lesson
- Follow the engineering methodology: Observe → Understand WHY → Predict → Design → Implement → Run → Break → Debug → Fix → Verify → Document → Commit → Push

## Git Rules

### Remote Configuration
- `origin` → GitHub (public portfolio) — fetch URL clean, push URL requires rotation
- `gitlab` → GitLab (CI/CD platform) — contains GitLab PAT in URL (acceptable for local config, never commit)
- Credentials must NOT be embedded in committed remote URLs

### Commit Policy
- One logical milestone per commit
- Commit message prefixes: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`
- Never commit internal AI state, reference project, or secrets
- Phase-end commits push to both remotes (after credential rotation)

### Push Order
1. `git status` — verify clean
2. `git diff --stat` — confirm intended changes
3. Manually inspect for secrets
4. Confirm `docs/internal/` excluded
5. Confirm `3-Tier DevSecOps Project` excluded
6. `git push gitlab main`
7. `git push origin main` (only after origin credential is rotated)

## Security Rules

### Secrets in CI/CD
All secrets stored as masked GitLab CI/CD variables:
- `SONAR_TOKEN` — SonarQube analysis token
- `DOCKER_HUB_USERNAME` — Docker Hub username
- `DOCKER_HUB_TOKEN` — Docker Hub access token
- `SLACK_WEBHOOK_URL` — Slack notification webhook
- Never in `.gitlab-ci.yml` directly

### Application Secrets in Kubernetes
- Kubernetes `Secret` objects use `stringData` in manifests (base64 in etcd)
- Current secrets in repo (`Anshuman`, `devopsShackSuperSecretKey`) are learning-phase values
- Production-grade secret handling deferred to Phase 9

## Architecture Rules

### CI/CD Platform
- GitLab CI/CD is the ONLY CI/CD platform
- Jenkins: reference architecture only — do not implement
- GitHub Actions: not used for this project's CI/CD

### MySQL Model Distinction
- Current implementation: `Deployment` + PVC (learning phase — do not replace silently)
- Production direction: `StatefulSet` + `volumeClaimTemplates` (Phase 9, explicit transition)

### Frontend Networking
- Browser is OUTSIDE the Kubernetes cluster
- Internal service names (`backend`, `mysql`) must never be assumed browser-resolvable
- Frontend communicates through Ingress: `/api` → backend Service
- Axios `baseURL: '/api'` — relative path, works behind NGINX Ingress

### Kubernetes Rollback
- Rollback is NOT automatic
- Exercise: bad image → failed/stalled rollout → diagnose → `kubectl rollout undo` → verify

### Monitoring
- Use `kube-prometheus-stack` via Helm
- Do not create hand-written Prometheus/Grafana manifests unless explicitly justified

## One-Task-Per-Cycle Rule

Each implementation cycle has exactly ONE logical objective.
Do not bundle unrelated changes into one implementation turn.
