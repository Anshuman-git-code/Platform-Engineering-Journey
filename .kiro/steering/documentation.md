# Documentation Standards

## Philosophy

Documentation is an engineering record, not a summary or tutorial. Every document answers:
1. What problem does this solve?
2. How does it work internally?
3. Why was it designed this way?
4. How was it verified?

Never start documentation with syntax or commands. Start with the engineering problem.

## Voice and Style

Write as an engineer documenting discoveries for another engineer joining the project.

**Use:**
- Declarative engineering statements: "The backend resolves `mysql` via CoreDNS."
- Precise technical language with reasoning and tradeoffs
- Evidence from actual commands run and actual output observed

**Never use:**
- "Now let's...", "Next we will...", "You should...", "Let me show you..."
- Tutorial-style language or motivational phrases

## Document Structure

Every major phase document contains these sections:

```
# Phase N — Component Title

## Objective
## Engineering Problem
## Architecture / How It Works      (ASCII diagrams required for networking)
## Implementation                   (per-component, with field-by-field reasoning)
## Verification                     (actual commands + actual output)
## Debugging Log                    (real bugs: symptom → root cause → fix → lesson)
## Production Considerations        (known limitations, production-oriented direction)
## Current Status                   (completed table, remaining table)
```

## Configuration Documentation Rule

For every Dockerfile instruction, YAML field, or config block:

```
**Engineering Problem:** What problem this solves
**What it does:** Precise description at the component level
**Component:** Which Kubernetes/Docker component reads/acts on this
**Project connection:** Trace to actual source code that consumes this value
**If missing or wrong:** Exact failure mode
```

## Networking Documentation Rule

For relevant request flows, show the complete path:

```
source process → protocol → DNS resolution → IP → network namespace
→ routing → NAT/proxy → destination Service → Pod → destination process
→ response path
```

Always document:
- Which port is in which namespace
- Whether it is published externally
- Whether it is internet-reachable

## Bug Documentation Rule

Never erase bugs to make the project look perfect. Document every real failure:

```
Symptom → Observed evidence → Affected layer → Root cause
→ Fix applied → Verification → Engineering lesson
```

Use V1/V2 pattern when correcting something:
```
## V1 State — Known Gap
[previous condition]

## V2 Fix — Implemented Change
[corrected condition + why + what was learned]
```

## Phase Documentation Files

| File | Phase |
|---|---|
| `docs/00-project-overview.md` | Project identity and roadmap |
| `docs/01-codebase-investigation.md` | Phase 0 |
| `docs/02-local-environment-verification.md` | Phase 0 verification |
| `docs/03-containerization-foundations.md` | Phase 1 Docker |
| `docs/04-image-construction.md` | Phase 2A image layers |
| `docs/05-backend-dockerfile-analysis.md` | Phase 2B backend |
| `docs/06-frontend-dockerfile-analysis.md` | Phase 3 frontend |
| `docs/07-docker-compose-analysis.md` | Phase 4 Compose |
| `docs/08-kubernetes-foundations.md` | Phase 5 K8s theory |
| `docs/09-kubernetes-deployment.md` | Phase 6 K8s deployment |
| `docs/10-kubernetes-frontend-ingress.md` | Phase 7 Ingress |
| `docs/11-gitlab-cicd.md` | Phase 8 GitLab CI/CD |
| `docs/architecture.md` | Application architecture reference |
| `docs/engineering-decisions.md` | All decisions with context/reasoning/result |
| `docs/learning-journal.md` | First-person conceptual evolution |

New phase documents follow the same numbering: `12-`, `13-`, etc.

## Engineering Decisions Format

```markdown
## Decision N — Short Title

### Context
### Decision
### Reasoning
### Tradeoffs (if applicable)
### Result
```

## Learning Journal Format

```markdown
## Phase N — Name

### On [Concept That Changed Understanding]

[2-4 paragraphs: initial mental model → discovery → what changed → why it matters]
```

Written in first person. Describes genuine understanding shifts, not textbook summaries.

## CI/CD Documentation Rule

Document the full pipeline with:
- Each stage: trigger, purpose, input, output, dependency, order rationale
- Failure behavior and recovery
- Security implications of each stage
- Actual pipeline execution output where relevant
