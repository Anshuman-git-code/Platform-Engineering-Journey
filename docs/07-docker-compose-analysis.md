# Phase 4 — Docker Compose

## Objective

Phase 4 is the first phase where the engineering focus shifts from individual containers to a system of containers. Every previous phase produced an isolated artifact: a backend image, a frontend image, an understanding of container networking. Phase 4 assembles those artifacts into a coordinated, reproducible application that starts with a single command.

The technical tool is Docker Compose. The engineering skill being developed is declarative system description — expressing what a system should be rather than how to build it step by step.

---

## The Engineering Problem Docker Compose Solves

### Manual Orchestration Does Not Scale

Running a three-tier application manually requires the following sequence, executed correctly and completely, every time:

```bash
docker network create app-network
docker volume create mysql-data
docker run -d --name mysql \
  --network app-network \
  -e MYSQL_ROOT_PASSWORD=... \
  -e MYSQL_DATABASE=crud_app \
  -v mysql-data:/var/lib/mysql \
  mysql:8

docker run -d --name backend-api \
  --network app-network \
  -e DB_HOST=mysql \
  -e DB_USER=root \
  -e DB_PASSWORD=... \
  -e DB_NAME=crud_app \
  -p 5000:5000 \
  backend:v1

docker run -d --name frontend-react \
  --network app-network \
  -p 3000:80 \
  frontend:v1
```

If any step is omitted, the application fails. If two developers execute these steps differently — different network names, different volume names, different environment variable values — their environments diverge. If a new engineer joins the team, a 20-page setup document awaits them.

This is not a workflow that scales.

### The Infrastructure as Code Shift

Docker Compose solves this by replacing the procedural sequence with a declarative description. Instead of telling Docker how to create infrastructure step by step, a `docker-compose.yml` file describes what infrastructure should exist. Docker Compose reads the description and creates it.

```
Imperative (Docker CLI):          Declarative (Docker Compose):

docker network create ...         services:
docker volume create ...            mysql:
docker run mysql ...                  image: mysql:8
docker run backend ...              backend:
docker run frontend ...               build: ./api
                                    frontend:
                                      build: ./client
```

The `docker-compose.yml` file is version-controlled alongside the application code. Every developer runs `docker compose up` and receives an identical environment. The infrastructure is no longer a manual procedure — it is a specification.

This is the foundational principle of Infrastructure as Code, which extends beyond Docker Compose to Kubernetes manifests, Terraform configurations, and CloudFormation templates. The mental model established here applies directly to every tool in that category.

---

## Pre-Compose Engineering Analysis

Five engineering questions were analyzed before opening `docker-compose.yml`.

**How many `docker run` commands does a three-service application require?**

At minimum three — one for each container. In practice, more: at least one `docker network create` and one `docker volume create` are also required, plus separate commands to build images if custom Dockerfiles are involved. Any omission produces a failure that may be difficult to diagnose. Docker Compose reduces all of this to one command.

**What happens when developers create different networks independently?**

Each developer ends up with a different network name. Service discovery — which depends on container names and DNS resolution on a shared network — breaks across environments. The README must account for every variation. The infrastructure state of one developer's machine cannot be reproduced reliably on another's. Docker Compose eliminates this by defining the network in the file. Everyone uses the same network because everyone runs the same file.

**What happens when the backend starts before MySQL?**

`ECONNREFUSED`. The backend attempts to connect to MySQL before MySQL has finished initializing. This failure was observed directly in Phase 2B. Docker Compose's `depends_on` addresses the startup ordering problem, though not the readiness problem — a distinction examined in detail later in this document.

**What happens when `DB_HOST=mysql` but the MySQL container is named `database`?**

Docker's internal DNS server resolves service names, not container names. If the service is defined as `mysql:` in the Compose file, DNS resolves `mysql` to the container's IP. If the backend expects `DB_HOST=mysql` but the service is named `database`, DNS resolution fails. The backend never reaches MySQL regardless of whether MySQL is running. Service names must match the values used in application configuration.

**One command or many commands?**

One command scales. Many commands do not. `docker compose up` creates the network, volumes, builds images if needed, starts containers in dependency order, and attaches to logs. A new engineer can reproduce the entire development environment without reading a setup document.

---

## The Conceptual Shift — Services vs Containers

The most important mental model change in Phase 4 is understanding that a service is not a container.

A service is a logical role in the application: `frontend`, `backend`, `mysql`. A container is a runtime instance that fulfills that role. The relationship is the same as between a job description and an employee: the job description is stable; the person filling it may change.

```
Service (stable logical identity)
      │
      ▼
One or more Containers (replaceable runtime instances)
```

In the current configuration, each service runs one container. In production, services can scale horizontally:

```
backend service → backend-1, backend-2, backend-3
```

Other services communicate with `backend` — the service name — not with `backend-1` or `backend-3`. Docker's internal DNS resolves the service name to whichever container instances are currently running. This is the same architectural pattern Kubernetes uses with Services and Pods, where the Service provides a stable network identity for a set of interchangeable Pod replicas.

---

## The docker-compose.yml

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8
    container_name: mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: Aditya
      MYSQL_DATABASE: crud_app
    volumes:
      - mysql-data:/var/lib/mysql
      - ./mysql-init:/docker-entrypoint-initdb.d
    ports:
      - "3306:3306"

  backend:
    build: ./api
    container_name: backend-api
    environment:
      DB_HOST: mysql
      DB_USER: root
      DB_PASSWORD: Aditya
      DB_NAME: crud_app
      JWT_SECRET: devopsShackSuperSecretKey
      RESET_ADMIN_PASS: 'true'
    depends_on:
      - mysql
    ports:
      - "5000:5000"

  frontend:
    build: ./client
    container_name: frontend-react
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  mysql-data:
```

---

## version

```yaml
version: '3.8'
```

In modern Docker Compose (v2 and the current Compose Specification), this line is optional. Docker Compose automatically interprets the file according to the current specification. Many contemporary Compose files omit it entirely.

Historically, Docker Compose evolved through multiple versions. Each version introduced new features. The `version:` field told the Compose engine which language specification to use when parsing the file. Version `3.8` refers to the Compose file format version 3.8, which introduced features like `deploy` settings and improved secrets handling.

The field is retained in this project for compatibility. It does not change the behavior of the instructions documented here.

---

## services

```yaml
services:
  mysql:
  backend:
  frontend:
```

`services:` is where the application description begins. Every key beneath `services:` is a service name — a logical identifier for a role in the application.

A service name is not a container name, not an image name, and not a hostname in the traditional sense. It is the name by which other services refer to this component:

- `DB_HOST: mysql` — the backend refers to the database service by name
- `depends_on: - mysql` — the backend declares its dependency using the service name
- Docker's internal DNS resolves `mysql` to the MySQL container's IP

When Docker Compose creates the network, it registers each service name in the internal DNS server. Traffic sent to `mysql:3306` from within any container in the Compose network is resolved and routed to the MySQL container. The service name is the stable network identity.

---

## image vs build

Two services in this file use fundamentally different source mechanisms.

### image: mysql:8

```yaml
mysql:
  image: mysql:8
```

MySQL's source code is not in this repository. The MySQL team maintains and publishes a production-grade image to Docker Hub. The correct approach is to consume the official image rather than attempting to build an equivalent.

`image: mysql:8` instructs Compose to pull `mysql:8` from Docker Hub if it is not already present locally, then create a container from it. No `docker build` occurs.

### build: ./api

```yaml
backend:
  build: ./api
```

The backend API is developed in this repository. Its Dockerfile is at `api/Dockerfile`. `build: ./api` instructs Compose to execute `docker build` against the `api/` directory — equivalent to running `docker build -t <generated-name> ./api` — and then create a container from the resulting image.

The same applies to the frontend:

```yaml
frontend:
  build: ./client
```

The distinction: `image:` is for third-party software already packaged and published. `build:` is for first-party application code that must be compiled into an image from source.

---

## container_name

```yaml
mysql:
  image: mysql:8
  container_name: mysql
```

`container_name:` assigns a specific name to the container Docker Compose creates for this service. Without it, Compose generates a name automatically — typically `<project-name>-<service-name>-<index>`, such as `myapp-mysql-1`.

The service name and the container name serve different purposes:

| Property | Used by | Purpose |
|---|---|---|
| Service name (`mysql:`) | Docker DNS, `depends_on`, other services | Stable logical identity — network routing |
| Container name (`container_name: mysql`) | `docker ps`, `docker logs`, `docker exec` | Human-readable handle for CLI operations |

This distinction matters for scaling. If `backend` scaled to three instances, all three would share the service name `backend` for DNS purposes, but each would need a unique container name. Docker generates unique names for replicated containers automatically. Manually setting `container_name:` prevents scaling because a name collision would occur.

Docker DNS resolves service names. `container_name` has no effect on DNS resolution. Changing `container_name: mysql` to `container_name: database123` does not break `DB_HOST: mysql` — because `DB_HOST` references the service name, not the container name.

---

## restart

```yaml
mysql:
  restart: always
```

`restart: always` instructs Docker to restart the container automatically whenever it stops — regardless of whether it stopped cleanly or crashed. If the host machine restarts, the container restarts with it.

Valid values:

| Value | Behavior |
|---|---|
| `no` (default) | Never restart automatically |
| `always` | Restart on any stop, including host reboot |
| `on-failure` | Restart only if the exit code is non-zero |
| `unless-stopped` | Restart unless explicitly stopped by the user |

`restart: always` is appropriate for the database because MySQL should be continuously available. If MySQL crashes, it should recover automatically without operator intervention. This is a basic availability guarantee suitable for development and simple production deployments.

---

## environment

```yaml
mysql:
  environment:
    MYSQL_ROOT_PASSWORD: Aditya
    MYSQL_DATABASE: crud_app

backend:
  environment:
    DB_HOST: mysql
    DB_USER: root
    DB_PASSWORD: Aditya
    DB_NAME: crud_app
    JWT_SECRET: devopsShackSuperSecretKey
    RESET_ADMIN_PASS: 'true'
```

### The Engineering Problem

Application code that contains hardcoded configuration values cannot be deployed across multiple environments without modification:

```javascript
// Hardcoded — requires source change per environment
const host = "mysql";
const password = "Aditya";
```

A professional application reads configuration from its environment:

```javascript
// Environment-driven — same code, different configuration
const host = process.env.DB_HOST;
const password = process.env.DB_PASSWORD;
```

The code is unchanged. The values supplied to it change per environment. This is the first principle of the 12-Factor App methodology: strict separation between code and configuration.

### How Environment Variables Are Injected

When Docker Compose starts a container, it injects the specified environment variables into the Linux process environment before the application starts. The injection happens at the OS level — the application reads them via standard process environment mechanisms (`process.env` in Node.js, `os.environ` in Python, `System.getenv()` in Java). No Docker API is involved at read time.

The startup sequence:

```
docker compose up
      │
      ▼
Docker creates container
      │
      ▼
Docker injects environment variables into Linux process environment:
  DB_HOST=mysql
  DB_USER=root
  DB_PASSWORD=Aditya
  DB_NAME=crud_app
  JWT_SECRET=devopsShackSuperSecretKey
      │
      ▼
Node.js process starts
      │
      ▼
process.env.DB_HOST → "mysql"
process.env.DB_PASSWORD → "Aditya"
      │
      ▼
MySQL connection established
```

### Why Variable Names Differ Between Services

`MYSQL_ROOT_PASSWORD` and `DB_PASSWORD` refer to the same concept — the MySQL root password — but are named differently. This is not inconsistency. It is a reflection of who owns each contract.

**`MYSQL_ROOT_PASSWORD`** — defined by the MySQL Docker image maintainers. The MySQL official image contains an entrypoint script that reads this exact variable name and uses it to configure the root user password during database initialization. The name cannot be changed. Renaming it in the Compose file would cause MySQL to ignore it.

**`DB_PASSWORD`** — defined by the backend application developer. The backend's Node.js code contains:

```javascript
const db = mysql.createConnection({
  password: process.env.DB_PASSWORD
});
```

The developer chose `DB_PASSWORD` as the variable name. It could have been `DATABASE_PASSWORD` or `MYSQL_PASS` — any name would work as long as the Compose file and the application code agree.

Docker delivers the values without interpreting them. Docker is the courier — it passes packages labeled with whatever names the sender specified. The recipient (the application) opens the package and uses the value.

**The general rule:** Before using any official Docker image, a DevOps engineer reads its documentation to discover which environment variable names it expects. Those names are part of the image's interface — fixed by its developers, not configurable by the user.

### Security Consideration

Credentials in a `docker-compose.yml` file committed to a repository are visible to every person with repository access. This is acceptable for a learning project. In production environments, values are externalized:

- `.env` files excluded from version control via `.gitignore`
- Docker secrets
- Kubernetes Secrets
- AWS Secrets Manager or equivalent

The application code does not change — only the source of the environment variable values changes. This is the same code-configuration separation principle applied at the secret management level.

---

## volumes

```yaml
mysql:
  volumes:
    - mysql-data:/var/lib/mysql
    - ./mysql-init:/docker-entrypoint-initdb.d

volumes:
  mysql-data:
```

### The Engineering Problem

Containers are ephemeral. When a container is removed, its writable layer — everything written to the container's filesystem at runtime — is permanently deleted. For a stateless application like the backend API or the frontend, this is acceptable and desirable. Every container starts from a clean, known state.

For a database, it is catastrophic. Every `docker compose down` would destroy all data. Every `docker compose up` would start with an empty database.

Volumes solve this by storing data outside the container's lifecycle. A volume exists independently in Docker's storage system. It can be mounted into a container, written to, unmounted, and mounted into a new container. The data persists across container replacements.

### mysql-data:/var/lib/mysql

```yaml
- mysql-data:/var/lib/mysql
```

**`mysql-data`** — a named volume defined in the top-level `volumes:` section. Docker creates it if it does not exist.

**`/var/lib/mysql`** — the directory inside the MySQL container where MySQL stores all database files: data pages, transaction logs, configuration state.

When MySQL writes data, it writes to `/var/lib/mysql` inside the container. Because this directory is mounted to the `mysql-data` volume, the writes go to the volume's storage location managed by Docker. When the container is removed and a new one is created with the same volume mounted, MySQL finds its data files at the same path and continues where it left off.

The top-level `volumes:` declaration:

```yaml
volumes:
  mysql-data:
```

Declares the volume to Compose. Docker creates it if it does not exist. No further configuration is required for basic usage.

### ./mysql-init:/docker-entrypoint-initdb.d

```yaml
- ./mysql-init:/docker-entrypoint-initdb.d
```

**`./mysql-init`** — a host directory path, relative to the `docker-compose.yml` file location.

**`/docker-entrypoint-initdb.d`** — a special directory recognized by the MySQL official image's entrypoint script. Any `.sql` or `.sh` files placed in this directory are executed automatically when the MySQL container initializes for the first time (when the data directory is empty).

This is how the initial database schema — the `users` table, any seed data — is applied automatically on first startup without manual intervention. The `mysql-init/` directory on the host contains the initialization SQL. Mounting it into the MySQL container makes it available to the entrypoint script.

---

## ports

```yaml
mysql:
  ports:
    - "3306:3306"

backend:
  ports:
    - "5000:5000"

frontend:
  ports:
    - "3000:80"
```

Port publishing in Docker Compose uses the same `host:container` format as `docker run -p`. The networking mechanism is identical — Docker Engine installs an iptables forwarding rule directing traffic from the host port to the container port via the bridge network.

**MySQL: `3306:3306`** — publishes the MySQL port to the host. This allows database clients running on the host (such as a local MySQL GUI tool) to connect to the containerized database. In a production environment where direct database access from outside the container network is undesirable, this port mapping would be removed.

**Backend: `5000:5000`** — publishes the API on the host, allowing direct API testing with curl or Postman.

**Frontend: `3000:80`** — maps host port 3000 to Nginx's port 80 inside the container. The browser accesses the application at `localhost:3000`. Nginx inside the container serves on port 80.

An important observation: inter-service communication within the Compose network does not use these port mappings. When the backend connects to MySQL at `mysql:3306`, it communicates directly through the internal bridge network. The `ports:` mapping is only for host-to-container access from outside the Compose network.

---

## depends_on

```yaml
backend:
  depends_on:
    - mysql

frontend:
  depends_on:
    - backend
```

### What depends_on Guarantees

`depends_on` defines the startup order of services. `backend` will not be started until the `mysql` service container has been started. `frontend` will not be started until the `backend` service container has been started.

The dependency graph:

```
frontend
    │
    └── depends_on → backend
                         │
                         └── depends_on → mysql
```

Compose starts `mysql` first, then `backend`, then `frontend`.

### What depends_on Does Not Guarantee

`depends_on` guarantees container started. It does not guarantee application ready.

When the MySQL container starts, the MySQL server inside it must still:
1. Initialize the storage engine
2. Create the root user
3. Apply the initialization SQL from `docker-entrypoint-initdb.d`
4. Begin listening on port 3306

This initialization takes several seconds. Compose starts the backend container as soon as the MySQL container has started — not when MySQL is accepting connections. The backend may attempt its database connection while MySQL is still initializing, producing `ECONNREFUSED`.

This is not a Compose defect. It is a deliberate design decision.

### Why Compose Does Not Wait for Application Readiness by Default

Docker manages containers. Docker does not manage applications. The meaning of "ready" varies by application:

- MySQL is ready when port 3306 accepts connections
- PostgreSQL is ready when it can execute a query
- RabbitMQ is ready when the message broker has initialized its queues
- A custom backend may be ready only after loading a machine learning model, warming a cache, and establishing all database connections

Docker cannot know what "ready" means for every application that might run in a container. Attempting to define universal readiness semantics would require Docker to understand the internals of every application, which is not possible.

The responsibility is divided correctly:

| Responsibility | Owner |
|---|---|
| Start the container | Docker Compose |
| Define what "ready" means | The application or image author (via health checks) |
| Handle not-yet-ready dependencies | The application (via retry logic) |

### Production Solutions

**Health checks** — Docker supports a `healthcheck:` directive that runs a command inside the container to verify readiness. `depends_on` can be configured with `condition: service_healthy` to wait until the health check passes before starting dependent services.

**Application retry logic** — the backend retries the MySQL connection on failure, waiting between attempts. Most production applications implement this because it works regardless of the deployment platform — Docker Compose, Kubernetes, or bare metal.

Both approaches are valid. Retry logic in the application is more portable; health checks in Compose are more explicit about the startup contract.

---

## Networks — Implicit Creation

This Compose file contains no explicit `networks:` section. Docker Compose creates a default bridge network automatically for every project.

When `docker compose up` executes, Compose:
1. Creates a bridge network named `<project-name>_default`
2. Attaches every service container to that network
3. Registers every service name in Docker's internal DNS server on that network

All three containers — `mysql`, `backend-api`, and `frontend-react` — are on the same network. The backend can reach MySQL at `mysql:3306`. The frontend communicates with the backend at `backend:5000` (for server-side rendering or proxied requests). MySQL is not directly reachable by the frontend.

Explicit network definitions are used when more complex topologies are needed — multiple networks for isolation, external networks shared between Compose projects, or custom subnet configuration. For this three-tier application, the default network is sufficient.

---

## The Declarative Model — Imperative vs Declarative

Phase 4 introduces a shift in how infrastructure is expressed that extends well beyond Docker Compose.

**Imperative** — describes the steps to produce the desired state:

```bash
docker network create app-network
docker volume create mysql-data
docker run -d --network app-network -e MYSQL_ROOT_PASSWORD=... mysql:8
docker run -d --network app-network -e DB_HOST=mysql ... backend:v1
docker run -d --network app-network -p 3000:80 frontend:v1
```

The engineer specifies how to create the infrastructure. If a step is missed or executed in the wrong order, the result is incorrect.

**Declarative** — describes the desired state:

```yaml
services:
  mysql:
    image: mysql:8
  backend:
    build: ./api
  frontend:
    build: ./client
```

The engineer specifies what should exist. Docker Compose determines how to create it, in what order, with what dependencies.

The declarative model is the foundation of:
- Docker Compose
- Kubernetes manifests
- Terraform configurations
- AWS CloudFormation
- Helm charts

Every one of these tools follows the same principle: describe the desired state; let the tool reconcile the current state to the desired state. Understanding this model in Docker Compose builds the mental framework for every infrastructure-as-code tool in the DevOps ecosystem.

---

## Current Status

### Completed

| Topic | Status |
|---|---|
| Why Docker Compose exists — the scaling problem | Complete |
| Imperative vs declarative infrastructure model | Complete |
| Infrastructure as Code introduction | Complete |
| Service vs container distinction | Complete |
| `version:` field and its historical context | Complete |
| `services:` — logical service description | Complete |
| `image:` vs `build:` — third-party vs first-party sources | Complete |
| `container_name:` vs service name — two separate identities | Complete |
| `restart:` policies | Complete |
| `environment:` — configuration management | Complete |
| 12-Factor App configuration separation | Complete |
| Why environment variable names differ between services | Complete |
| Docker as a value delivery mechanism (courier model) | Complete |
| `volumes:` — data persistence beyond container lifecycle | Complete |
| Named volumes — `mysql-data:/var/lib/mysql` | Complete |
| Bind mount — `./mysql-init:/docker-entrypoint-initdb.d` | Complete |
| `ports:` — host-to-container vs internal service communication | Complete |
| `depends_on:` — startup ordering | Complete |
| Container started vs application ready distinction | Complete |
| Why Compose does not wait for application readiness by default | Complete |
| Implicit network creation and DNS registration | Complete |
| Service name as stable DNS identity | Complete |
| The declarative infrastructure model | Complete |

### Remaining — Phase 4 Practical

| Topic | Status |
|---|---|
| `docker compose up` lifecycle | Pending |
| Complete system startup and verification | Pending |
| End-to-end application testing | Pending |
| `docker compose logs` | Pending |
| `docker compose ps` | Pending |
| `docker compose down` | Pending |
| Debugging multi-container failures | Pending |
| Engineering retrospective | Pending |
| Git commit | Pending |
