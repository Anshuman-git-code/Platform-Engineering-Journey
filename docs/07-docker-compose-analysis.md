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
| docker-compose.yaml — line-by-line project analysis | Complete |
| Volume architecture — named vs bind mount | Complete |
| docker compose up lifecycle | Complete |
| Debugging workflow | Complete |
| Phase 4 engineering retrospective | Complete |

### Phase 4 Status: Complete

Phase 4 is closed. The complete `docker-compose.yaml` has been analyzed line by line in the context of this specific project. The system brings up frontend, backend, and MySQL as a coordinated application with one command.

---

## docker-compose.yaml — Complete Line-by-Line Project Analysis

This section analyzes every line of the project's `docker-compose.yaml` in the context of the actual application source code. Each instruction is traced back to the specific file or code path it connects to.

The complete file:

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

### version: '3.8'

```yaml
version: '3.8'
```

Specifies the Compose file format version. Modern Docker Compose (v2+) does not require this field and interprets files according to the current Compose Specification automatically. It is retained here for compatibility. No instruction in this file requires any feature beyond what version 3.8 provides.

---

### mysql service

#### image: mysql:8

```yaml
image: mysql:8
```

Instructs Compose to pull the official MySQL 8 image from Docker Hub if not present locally. No `Dockerfile` is used for MySQL — the image is maintained by the MySQL team and published to Docker Hub. `mysql:8` pins to the MySQL 8 major version, meaning minor and patch updates are applied on pull but breaking changes from MySQL 9+ are avoided.

**Project connection:** The backend at `api/models/db.js` uses `mysql2` to connect to this database. The `crud_app` database and `users` table it expects are created by this container's initialization mechanism.

---

#### container_name: mysql

```yaml
container_name: mysql
```

Assigns the explicit name `mysql` to the created container. Without this, Compose would generate a name like `docker-kubernetes-cicd-implementation-mysql-1`.

**Project connection:** The container name is used for `docker logs mysql`, `docker exec -it mysql sh`, and `docker compose stop mysql` during development operations. It does not affect DNS resolution — that is governed by the service name `mysql:`.

---

#### restart: always

```yaml
restart: always
```

Configures Docker to restart the MySQL container automatically whenever it stops, including on host machine restart.

**Project connection:** MySQL is the data tier of the application. If it crashes, all data operations fail immediately. The backend cannot serve any authenticated request without MySQL. `restart: always` provides basic fault recovery without operator intervention.

---

#### MYSQL_ROOT_PASSWORD: Aditya

```yaml
MYSQL_ROOT_PASSWORD: Aditya
```

Sets the MySQL root user password during first-time database initialization. This variable name is defined by the MySQL Docker image's entrypoint script at `/docker-entrypoint.sh`. Docker delivers this value to the container environment; the MySQL entrypoint reads it and calls the equivalent of `ALTER USER 'root'@'%' IDENTIFIED BY 'Aditya'`.

**Project connection:** The backend's `api/models/db.js` connects as the root user:

```javascript
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,       // "root"
  password: process.env.DB_PASSWORD, // "Aditya"
  database: process.env.DB_NAME
});
```

The value `Aditya` here must match `DB_PASSWORD: Aditya` in the backend environment section. Both refer to the same MySQL root credential.

---

#### MYSQL_DATABASE: crud_app

```yaml
MYSQL_DATABASE: crud_app
```

Instructs the MySQL entrypoint to create a database named `crud_app` during initialization if it does not already exist. This variable name is also defined by the MySQL image's entrypoint.

**Project connection:** `api/models/db.js` connects to `crud_app`:

```javascript
database: process.env.DB_NAME  // "crud_app"
```

And `api/.env` (for local development without Compose) also specifies:

```
DB_NAME=crud_app
```

The `users` table that the application queries is created within this database — either by the `mysql-init` SQL scripts or by the application's own schema on first run.

---

#### mysql-data:/var/lib/mysql

```yaml
volumes:
  - mysql-data:/var/lib/mysql
```

Mounts the named Docker volume `mysql-data` at `/var/lib/mysql` inside the MySQL container.

`/var/lib/mysql` is MySQL's internal data directory — the location where MySQL stores all database files: InnoDB tablespace files, binary logs, redo logs, and the `crud_app/` directory containing the `users` table data. This path is defined by MySQL, not by Docker.

**Engineering significance:** Without this volume mount, all data written to `/var/lib/mysql` lives only in the container's writable layer. `docker compose down` removes the container and deletes the writable layer — every user account, every registered user record, every session is permanently lost. With the volume mount, the data files live in Docker's managed volume storage. The container can be removed and recreated without affecting the data.

**Project connection:** Every INSERT, UPDATE, or DELETE executed by `api/controllers/userController.js` and `api/controllers/authController.js` ultimately writes to files in `/var/lib/mysql/crud_app/`. These files persist beyond any individual container's lifetime because they are stored in `mysql-data`.

---

#### ./mysql-init:/docker-entrypoint-initdb.d

```yaml
- ./mysql-init:/docker-entrypoint-initdb.d
```

A bind mount — not a Docker volume. The host directory `./mysql-init` (relative to `docker-compose.yaml`) is mounted at `/docker-entrypoint-initdb.d` inside the MySQL container.

`/docker-entrypoint-initdb.d` is a special directory recognized by the MySQL Docker image's entrypoint. Any `.sql` or `.sh` files present in this directory are executed automatically during the very first initialization — when the data directory is empty. On subsequent starts (when `mysql-data` already contains data), the directory is ignored.

**Project connection:** This is where the `users` table schema SQL lives. The application expects:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'viewer') DEFAULT 'viewer',
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Without this initialization, `app.js`'s `initAdminUser()` function — which runs `SELECT * FROM users WHERE email = ?` on startup — would fail with a "table doesn't exist" error.

---

#### ports: "3306:3306" (mysql)

```yaml
ports:
  - "3306:3306"
```

Publishes MySQL's port 3306 to the host.

**Project connection:** This port mapping is not needed for the backend-to-MySQL communication inside Compose. The backend connects to `mysql:3306` through the internal bridge network without any host port mapping. This mapping is provided so that local MySQL GUI tools (such as TablePlus or MySQL Workbench) running on the developer's Mac can connect to the containerized database for inspection and debugging.

In production, this mapping would be removed — there is no reason to expose the database port to outside the container network.

---

### backend service

#### build: ./api

```yaml
build: ./api
```

Instructs Compose to execute `docker build` against the `api/` directory before creating the backend container. Compose uses `api/Dockerfile` and the `api/` directory as the build context.

The `api/Dockerfile` produces an image that includes the Node.js runtime, all production npm dependencies, and all application source files. This is the image analyzed in detail in `05-backend-dockerfile-analysis.md`.

**Project connection:** The built image contains `app.js`, `controllers/`, `routes/`, `middleware/`, `models/` — the entire backend application. `CMD ["node", "app.js"]` in the Dockerfile starts the Express server when the container runs.

---

#### container_name: backend-api

```yaml
container_name: backend-api
```

Assigns the explicit name `backend-api` to the container. Note that the container name differs from the service name (`backend`). The container name is used in CLI operations. The service name is used by Docker DNS.

**Project connection:** `docker logs backend-api` and `docker exec -it backend-api sh` use this name during debugging. The frontend does not reference `backend-api` anywhere — it references the service name `backend` (or in the current frontend build, it communicates via `REACT_APP_API` which is set to `http://localhost:5000` in the client `.env` file, addressed in the networking discussion below).

---

#### DB_HOST: mysql

```yaml
environment:
  DB_HOST: mysql
```

Sets the environment variable `DB_HOST` to the string `mysql`. When the backend container starts, the Linux process environment contains `DB_HOST=mysql`.

**Project connection — exact code path:**

`api/models/db.js`:
```javascript
const db = mysql.createConnection({
  host: process.env.DB_HOST,  // ← reads "mysql" from Linux environment
  ...
});
```

`mysql` here is Docker's internal DNS hostname for the `mysql` service. Docker DNS resolves `mysql` → `172.x.x.x` (the MySQL container's IP on the Compose bridge network). The Node.js `mysql2` driver calls `getaddrinfo("mysql")` which the kernel resolves through Docker's DNS server.

This is the direct resolution of the `ECONNREFUSED 127.0.0.1:3306` error observed in Phase 2B. When running without Compose, the backend's `api/.env` had `DB_HOST=localhost`, which resolved to the container's own loopback interface — where no MySQL was listening. In Compose, `DB_HOST=mysql` resolves to the MySQL container on the shared network.

---

#### DB_USER: root

```yaml
DB_USER: root
```

**Project connection:**

`api/models/db.js`:
```javascript
user: process.env.DB_USER,  // ← "root"
```

Must match `MYSQL_ROOT_PASSWORD` in the mysql service — both refer to the MySQL root user. The application connects as root. In a production deployment, a dedicated application user with least-privilege permissions would replace root.

---

#### DB_PASSWORD: Aditya

```yaml
DB_PASSWORD: Aditya
```

**Project connection:**

`api/models/db.js`:
```javascript
password: process.env.DB_PASSWORD,  // ← "Aditya"
```

This value must exactly match `MYSQL_ROOT_PASSWORD: Aditya` set in the mysql service. The MySQL server was initialized with this password. The backend authenticates with this password. If either value changes without changing the other, the backend cannot connect.

---

#### DB_NAME: crud_app

```yaml
DB_NAME: crud_app
```

**Project connection:**

`api/models/db.js`:
```javascript
database: process.env.DB_NAME,  // ← "crud_app"
```

Must match `MYSQL_DATABASE: crud_app` from the mysql service. The MySQL container creates a database named `crud_app` on first startup. The backend connects to that database. All queries in `userController.js` and `authController.js` operate within this database.

---

#### JWT_SECRET: devopsShackSuperSecretKey

```yaml
JWT_SECRET: devopsShackSuperSecretKey
```

**Project connection:**

`api/controllers/authController.js`:
```javascript
const SECRET = process.env.JWT_SECRET || 'supersecret';
```

```javascript
const token = jwt.sign(
  { id: user.id, role: user.role },
  SECRET,         // ← signs the token with this secret
  { expiresIn: '1h' }
);
```

`api/middleware/auth.js` uses the same secret to verify every incoming JWT on protected routes. The secret must be consistent between the token-signing code and the verification code. Because both run inside the same container (the backend), both read from the same environment variable.

In production, this value must be a cryptographically random string of sufficient length, stored in a secrets manager — not committed to version control.

---

#### RESET_ADMIN_PASS: 'true'

```yaml
RESET_ADMIN_PASS: 'true'
```

**Project connection:**

`api/app.js`, inside `initAdminUser()`:
```javascript
if (process.env.RESET_ADMIN_PASS === 'true') {
  db.query(
    'UPDATE users SET password = ?, name = ?, role = ? WHERE email = ?',
    [hashedPassword, name, role, email],
    ...
  );
}
```

When `RESET_ADMIN_PASS` is `'true'`, the application resets the admin password to `admin123` on every startup. This is a development convenience — it ensures the admin account is always in a known state when the Compose stack restarts. In production, this value would be `'false'` or omitted entirely.

---

#### depends_on: mysql

```yaml
depends_on:
  - mysql
```

Instructs Compose to start the `mysql` service container before starting the `backend` container. Does not guarantee MySQL has finished initialization.

**Project connection:** The backend's `db.connect()` in `api/models/db.js` is called during module loading — at the moment `app.js` starts. If MySQL is still initializing when the backend starts, `db.connect()` throws. The application crashes. The container exits with code 1. In this project, the `restart: always` directive on MySQL, combined with the typical initialization time, usually allows the backend to connect successfully on the first or second attempt.

---

#### ports: "5000:5000" (backend)

```yaml
ports:
  - "5000:5000"
```

Publishes the backend API on host port 5000.

**Project connection:** `api/app.js`:
```javascript
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
```

The backend listens on port 5000 inside the container. The port mapping forwards host traffic at `localhost:5000` to the container.

**Frontend connection:** `client/.env`:
```
REACT_APP_API=http://localhost:5000
```

`client/src/axios.js`:
```javascript
const instance = axios.create({
  baseURL: process.env.REACT_APP_API || 'http://localhost:5000',
});
```

The React application was built with `REACT_APP_API=http://localhost:5000` baked into the JavaScript bundle at build time. The browser (running on the user's machine, outside all containers) sends API requests to `http://localhost:5000`. Those requests reach the host's port 5000, which Docker forwards into the backend container. This is why the backend port mapping is essential even though the frontend and backend are on the same Compose network — the browser is not inside the Docker network.

---

### frontend service

#### build: ./client

```yaml
build: ./client
```

Instructs Compose to execute the multi-stage build defined in `client/Dockerfile`. Stage 1 installs 1350 packages and runs `npm run build`. Stage 2 starts from `nginx:alpine` and copies only the `build/` output.

**Project connection:** The resulting image contains Nginx and the static React build. The JavaScript bundle contains `REACT_APP_API=http://localhost:5000` baked in at build time. This means the browser will send API calls to port 5000 on the host machine — which routes into the backend container via the `5000:5000` port mapping.

---

#### container_name: frontend-react

```yaml
container_name: frontend-react
```

CLI handle for the frontend container. Used with `docker logs frontend-react` and `docker exec -it frontend-react sh`.

---

#### ports: "3000:80" (frontend)

```yaml
ports:
  - "3000:80"
```

Maps host port 3000 to container port 80 where Nginx is listening.

**Project connection:** `client/Dockerfile`:
```dockerfile
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Nginx inside the frontend container serves the React build from `/usr/share/nginx/html` on port 80. The browser accesses the application at `http://localhost:3000`. Docker forwards that traffic to Nginx at port 80.

---

#### depends_on: backend

```yaml
depends_on:
  - backend
```

Ensures the backend container is started before the frontend container. Since the frontend is a static file server with no active connection to the backend at startup, this dependency is precautionary — it ensures the backend is started and likely listening by the time a user's browser sends its first API request.

---

### top-level volumes

```yaml
volumes:
  mysql-data:
```

Declares the named volume `mysql-data` at the project level. Docker creates this volume if it does not exist when `docker compose up` runs. The volume persists after `docker compose down`. It is removed only by `docker compose down -v` or `docker volume rm`.

**Engineering significance:** The top-level declaration is required. Without it, the `mysql-data:/var/lib/mysql` mount in the mysql service would reference an undefined volume and Compose would fail to start. The empty `mysql-data:` declaration creates a standard Docker-managed volume with default settings.

---

## Volume Architecture

### Named Volume vs Bind Mount — A Direct Comparison

The Compose file uses both volume types for different purposes:

```
mysql-data:/var/lib/mysql          ← Named volume (Docker owns storage)
./mysql-init:/docker-entrypoint-initdb.d  ← Bind mount (project owns storage)
```

| Property | Named Volume (`mysql-data`) | Bind Mount (`./mysql-init`) |
|---|---|---|
| Storage location | Docker-managed (`/var/lib/docker/volumes/`) | Host filesystem (`./mysql-init/`) |
| Controlled by | Docker | Developer |
| Persists after `docker compose down` | Yes | Yes (it is a host directory) |
| Removed by `docker compose down -v` | Yes | No |
| Purpose | Persistent database storage | Read-once initialization scripts |
| Contents managed by | MySQL (writes at runtime) | Developer (provides SQL schema) |

**What happens if the named volume is deleted:**
`docker compose down -v` removes the volume. The next `docker compose up` creates a new empty volume. MySQL initializes from scratch. The `mysql-init` SQL scripts execute again. The database is empty — all user accounts created via the application are gone.

**What happens if the bind mount directory is deleted:**
The `mysql-init` directory is removed from the host. The bind mount cannot be created. `docker compose up` may fail or MySQL may start without executing the initialization scripts. If the named volume already contains data, MySQL ignores `docker-entrypoint-initdb.d` anyway — it only reads that directory on first initialization.

---

## docker compose up — Lifecycle

When `docker compose up` executes against this file, Compose performs the following operations in order:

```
1. Parse docker-compose.yaml
        │
        ▼
2. Create bridge network: <project>_default
   Register DNS entries: mysql, backend, frontend
        │
        ▼
3. Create named volume: mysql-data (if not exists)
        │
        ▼
4. Build images (if build: is specified)
   docker build ./api  → backend image
   docker build ./client → frontend image (two-stage)
        │
        ▼
5. Pull images (if image: is specified and not cached)
   mysql:8
        │
        ▼
6. Create containers in dependency order:
   mysql first (no dependencies)
   backend second (depends_on: mysql)
   frontend third (depends_on: backend)
        │
        ▼
7. For each container:
   - Inject environment variables
   - Mount volumes (mysql-data, ./mysql-init)
   - Attach to bridge network
   - Apply port publishing rules
        │
        ▼
8. Start processes:
   mysql: mysqld (MySQL server)
   backend: node app.js (Express API)
   frontend: nginx -g daemon off; (Nginx file server)
        │
        ▼
9. Attach to stdout/stderr of all containers (unless -d flag)
```

The result is a fully connected three-tier application:

```
Browser (host)
      │
      │ GET http://localhost:3000
      ▼
Nginx (frontend-react container, port 80)
      │ serves index.html + JS bundle
      ▼
Browser executes React JS
      │
      │ API request to http://localhost:5000
      ▼
Host → Docker port 5000 forwarding rule
      │
      ▼
Express (backend-api container, port 5000)
      │
      │ mysql2 connection to mysql:3306
      ▼
Docker DNS: mysql → 172.x.x.x
      │
      ▼
MySQL (mysql container, port 3306)
      │
      ▼
/var/lib/mysql → mysql-data volume → host disk
```

---

## Common Debugging Workflow

When `docker compose up` produces unexpected behavior, the following sequence isolates the failure layer:

**1. Check container status**

```bash
docker compose ps
```

Shows each service's container name, state (Up/Exited), and port mappings. An `Exited` state with a non-zero exit code indicates PID 1 crashed.

**2. Inspect logs**

```bash
docker compose logs
docker compose logs backend
docker compose logs mysql
```

The most important first step after confirming a container has exited. Logs reveal the application's own error output — `ECONNREFUSED`, `MODULE_NOT_FOUND`, initialization errors. The failure layer (networking, application, database) is usually identifiable from the log content.

**3. Enter a running container**

```bash
docker compose exec backend sh
docker compose exec mysql sh
```

Opens an interactive shell inside the running container. From inside the backend container:

```bash
printenv | grep DB        # verify environment variables were injected
ping mysql                # verify DNS resolution
nslookup mysql            # verify DNS returns an IP
```

**4. Verify data persistence**

```bash
docker compose exec mysql sh
mysql -u root -pAditya
SHOW DATABASES;
USE crud_app;
SHOW TABLES;
SELECT * FROM users;
```

Confirms the database, schema, and data are present inside the running MySQL container.

**5. Shutdown**

```bash
docker compose down           # stop and remove containers, preserve volumes
docker compose down -v        # stop, remove containers AND volumes (resets database)
```

`docker compose down` is the clean shutdown. It removes containers but preserves the `mysql-data` volume. `docker compose down -v` removes volumes — use only when a full reset is required.

---

## Phase 4 Engineering Retrospective

### What Was Built

A complete, one-command-startup three-tier application described entirely in `docker-compose.yaml`. The system comprises:

- A MySQL 8 database with persistent data storage, automatic schema initialization, and automatic restart
- A Node.js + Express API with environment-injected configuration, startup dependency ordering, and host port access for development
- A React + Nginx frontend with a multi-stage build, port mapping from host 3000 to container 80, and a dependency on the backend service

`docker compose up` starts all three containers in the correct order on a shared bridge network with DNS-based service discovery. `docker compose down` cleanly stops the system while preserving database state.

### What Phase 4 Established

**The shift from containers to systems.** Earlier phases developed expertise in individual containers. Phase 4 developed the skill of describing a set of containers as a system — with relationships, dependencies, shared state, and a single reproducible startup procedure.

**The declarative model applies beyond Docker.** Kubernetes manifests, Terraform configurations, Helm charts, and CloudFormation templates all follow the same principle: describe the desired state; let the tool create it. Understanding this model in Docker Compose provides the conceptual foundation for every infrastructure-as-code tool.

**Configuration as a deployment-time concern.** The application code reads from `process.env`. The Compose file supplies the values. The same image runs in development, CI, staging, and production with different environment variables. No code change is required to change environments.

**The MySQL ECONNREFUSED error is resolved.** The failure observed in Phase 2B — where `DB_HOST=localhost` inside a container resolved to the container's own loopback interface — is resolved by `DB_HOST: mysql` in the Compose environment, which resolves to the MySQL service container via Docker's internal DNS.

### Docker Learning Track — Complete

```
Phase 0  Engineering Investigation           ✅
Phase 1  Docker Fundamentals                 ✅
Phase 2A Image Construction                  ✅
Phase 2B Backend Containerization            ✅
Phase 3  Frontend Containerization           ✅
Phase 4  Docker Compose                      ✅
```

The Docker learning track is complete. Every container concept from images to multi-container orchestration has been investigated, verified experimentally, and documented.

**Next: Kubernetes** — Phase 5 applies the same engineering discipline to container orchestration at scale: multiple nodes, declarative deployments, services, ingress, persistent volumes, and configuration management across a cluster. The mental models from Docker and Docker Compose — images, containers, services, networking, volumes, declarative descriptions — apply directly and are extended by Kubernetes's additional capabilities.