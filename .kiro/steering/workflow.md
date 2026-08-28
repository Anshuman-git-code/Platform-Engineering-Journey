# Workflow and Session Management

## Engineering Methodology

Every task follows this sequence without exception:

```
Observe → Understand WHY → Predict → Design → Implement
→ Run → Break → Debug → Fix → Verify → Document → Commit → Push
```

Never begin implementation when the engineering problem is not yet understood.

## Session Start Protocol

At the start of every session, in this exact order:

1. Read `docs/internal/PROJECT_MEMORY.md`
2. Read `docs/internal/PROJECT_CONTEXT.md`
3. Read `docs/internal/AI_HANDOFF.md`
4. Read `docs/internal/AI_STATE.json`
5. Read `docs/internal/NEXT_STEPS.md`
6. Verify actual repository state against those files
7. Check `git status`, `git remote -v`, actual file contents
8. Report: what is complete, what is partial, what is not started, any discrepancies
9. State current phase and exact next task

**Repository always wins over state files.**
If a state file says something is complete but the repository lacks the implementation,
the repository is correct and the state file must be updated.

## One-Task-Per-Cycle Rule

Each implementation turn has exactly ONE logical objective.
State it explicitly before beginning.
Verify it explicitly after completing.

## State Update Frequency

After every completed logical task, update:
- `docs/internal/AI_STATE.json`
- `docs/internal/AI_HANDOFF.md`
- `docs/internal/NEXT_STEPS.md`

After every major phase, also update:
- `docs/internal/PROJECT_MEMORY.md` (if project fundamentals changed)
- `docs/internal/PROJECT_CONTEXT.md`
- Phase documentation file
- `docs/engineering-decisions.md`
- `docs/learning-journal.md`
- `docs/00-project-overview.md` phase table

## Checkpoint Format

After every completed logical task, report:

```
CHECKPOINT COMPLETE

Completed: [what was done]
Files Modified: [list]
Verified: [how it was verified]
Current Phase: [name]
Current Milestone: [name]
Remaining: [immediate next items]
Next Task: [exactly one]
Recovery: [how another session can continue from here]
```

## Phase Completion Checklist

A phase is NOT complete until all of these are true:

- [ ] Implementation complete
- [ ] Runtime verified (application behaves correctly)
- [ ] Failure path verified where appropriate
- [ ] Phase documentation file created/updated
- [ ] `docs/engineering-decisions.md` updated
- [ ] `docs/learning-journal.md` updated
- [ ] `docs/00-project-overview.md` phase table updated
- [ ] `docs/internal/` state files synchronized
- [ ] `git status` reviewed — no unexpected files
- [ ] `git diff --stat` reviewed — only intended changes
- [ ] Secrets confirmed absent from staged files
- [ ] `docs/internal/` confirmed excluded
- [ ] `3-Tier DevSecOps Project/` confirmed excluded
- [ ] `git commit` created with appropriate message
- [ ] `git push gitlab main` successful
- [ ] `git push origin main` successful (only after origin credential rotation)
- [ ] Phase marked COMPLETE in state files

## Human Approval Gates

Require explicit human confirmation before:
- Beginning implementation after any planning response
- Creating AWS resources (with cost disclosure)
- Destroying any infrastructure
- Modifying production-equivalent resources
- Pushing a phase containing unexpected files
- Any operation that cannot be easily reversed

## Failure Classification

Before changing anything, classify the failure:

```
Application logic? → Container? → Image? → Kubernetes object?
→ Service/DNS? → Networking? → Storage? → CI/CD? → Cloud infrastructure?
```

Collect evidence at each layer. Do not change multiple layers simultaneously.
Use: logs, events, describe, status, diff, network requests, config, source code.

## What Must Never Be Committed

- `docs/internal/` (AI state)
- `3-Tier DevSecOps Project/` (reference project)
- `node_modules/`
- `.env` files
- Any secret, token, or credential
- Generated build artifacts (`client/build/`)
- `.DS_Store`, temporary files

## Current Roadmap Order

```
Phase 8 CI/CD (IN PROGRESS — 8A done)
    8.5 Compilation validation
    8.6 GitLeaks
    8.7 SonarQube
    8.8 Quality Gate
    8.9 Trivy FS
    8.10 Backend Docker build
    8.11 Frontend Docker build
    8.12 Trivy image scans
    8.13 Docker Hub push
    8.14 Kubernetes deployment (Minikube)
    8.15 Rollout verification
    8.16 Failure/recovery exercises
Phase 9 Production Kubernetes Hardening
Phase 10 Helm
Phase 11 Terraform
Phase 12 AWS EKS
Phase 13 Production Ingress + TLS
Phase 14 Monitoring
Phase 15 Notifications
Final Documentation / Retrospective / Git cleanup
```

## Blocked Items (Current)

1. **GitHub push blocked** — `origin` push URL contains compromised credential.
   Unblock: Human rotates GitHub PAT, then `git remote set-url origin https://github.com/Anshuman-git-code/Platform-Engineering-Journey.git`

2. **Phase 8A verification partially confirmed** — GitLab runner pipeline passed per
   session history, but cannot be re-verified from current session without human
   running `gitlab-runner verify` and checking GitLab pipeline UI.

3. **Phase 8.7–8.8 (SonarQube)** — requires human to start SonarQube Docker container
   locally and create project + token before pipeline stage can be implemented.

4. **Phase 8.5–8.6 (Compilation + GitLeaks)** — requires `gitleaks` installed on runner
   Mac: `brew install gitleaks` (manual action required).

5. **Phase 8.9, 8.12 (Trivy)** — requires `trivy` installed on runner Mac:
   `brew install trivy` (manual action required).
