# Codebase Investigation

## Phase 0 — Understanding an Unknown Codebase Before Infrastructure Modernization

### Goal

Understand the application completely before introducing any infrastructure technology.

Docker, Kubernetes, Terraform, Jenkins, and CI/CD were intentionally ignored at this stage. The only focus was the application itself — what it does, how it is structured, and how its layers communicate.

---

## Investigation Approach

The README was not read first. Instead, the repository was investigated directly. This is a deliberate engineering habit — understanding a codebase from its structure and code rather than from its description builds a more accurate mental model.

### Step 1 — Folder Structure Analysis

```
docker-kubernetes-cicd-implementation/
├── api/        → backend
└── client/     → frontend
```

Folder names alone communicate intent. `api` signals a backend service. `client` signals a frontend application. There is no database folder because the database runs as an external service — it is not part of the repository.

---

### Step 2 — Identifying Technologies via package.json

Rather than assuming the technology stack, it was read directly from the dependency manifests.

**`client/package.json` — key dependencies:**

| Package | What it tells us |
|---|---|
| `react` | This is a React frontend |
| `react-router-dom` | Client-side routing is implemented |
| `axios` | HTTP requests are made to a backend API |
| `chart.js` | Data visualization is present |

**`api/package.json` — key dependencies:**

| Package | What it tells us |
|---|---|
| `express` | Node.js web framework — this is a REST API |
| `mysql2` | The backend communicates with a MySQL database |
| `jsonwebtoken` | JWT-based authentication is implemented |
| `bcryptjs` | Passwords are hashed before storage |
| `dotenv` | Configuration is externalized via environment variables |
| `cors` | Cross-origin requests are handled — frontend and backend run on separate origins |

**Important distinction identified:**

A `.js` file extension only identifies the programming language (JavaScript). It does not identify the framework. Framework identification requires reading the dependencies.

| Attribute | Value |
|---|---|
| Language | JavaScript |
| Frontend Technology | React |
| Backend Runtime | Node.js |
| Backend Framework | Express |
| Database | MySQL |

---

### Step 3 — Entry Point Analysis

**`api/app.js`** was inspected as the backend entry point. It revealed:

- Express application initialized
- CORS middleware registered
- Body parser middleware registered
- Routes mounted: `/api/auth` and `/api/users`
- MySQL connection established on startup
- Admin user auto-created if not present
- Server bound to `0.0.0.0:5000`

**`client/src/index.js`** was inspected as the frontend entry point. It revealed:

- React application mounted to the DOM
- Router wrapping the entire application
- Auth context provided globally

---

### Step 4 — Route and Controller Analysis

**`api/routes/`** revealed two route groups:

- `authRoutes.js` — handles login and registration
- `userRoutes.js` — handles user CRUD operations

**`api/controllers/`** revealed the business logic:

- `authController.js` — validates credentials, hashes passwords, issues JWT tokens
- `userController.js` — handles create, read, update, delete operations on users

**`api/middleware/`** revealed two middleware layers:

- `auth.js` — validates JWT token on protected routes
- `role.js` — enforces role-based access control (admin vs viewer)

---

### Step 5 — Frontend Structure Analysis

**`client/src/pages/`** revealed:

- `Login.js` — login form, calls auth API, stores token
- `Register.js` — registration form
- `UserDashboard.js` — main dashboard, fetches and displays users, admin-only edit/delete
- `NotFound.js` — 404 handler

**`client/src/context/AuthContext.js`** — manages authentication state globally using React Context API. Stores JWT token and user object, provides login/logout/register functions to all components.

**`client/src/axios.js`** — a configured Axios instance that automatically attaches the JWT token to outgoing requests via an interceptor.

---

### Step 6 — Database Model Analysis

**`api/models/db.js`** — creates and exports a MySQL connection pool using credentials from environment variables. It is not the database itself. The database runs externally. This file is purely the communication layer between the API and MySQL.

---

## Application Flow

```
Browser
  ↓
React Frontend (port 3000)
  ↓  HTTP Request (axios)
Express API (port 5000)
  ↓  SQL Query (mysql2)
MySQL Database (port 3306)
  ↓  Query Result
Express API
  ↓  JSON Response
React Frontend
  ↓  Rendered UI
Browser
```

---

## Architectural Observations

The application follows a classic three-tier architecture with clean separation of concerns:

**Presentation Tier (React)**
- Responsible only for UI and user interaction
- Has no direct database access
- Communicates exclusively through the API

**Application Tier (Node.js + Express)**
- Responsible for all business logic
- Validates input, enforces authorization, hashes passwords, issues tokens
- Acts as the only gateway to the database

**Data Tier (MySQL)**
- Responsible only for persistent storage
- Accessed exclusively by the application tier
- Not exposed to the frontend under any circumstances

This separation enables independent development, independent deployment, and clear fault isolation — properties that become critical when introducing containerization and orchestration.

---

## Technology Stack Summary

| Component | Technology | Version |
|---|---|---|
| Frontend | React | 19.1.0 |
| Frontend routing | React Router DOM | 7.6.2 |
| HTTP client | Axios | 1.10.0 |
| Backend runtime | Node.js | 24.3.0 |
| Backend framework | Express | 4.18.2 |
| Database driver | mysql2 | 3.9.0 |
| Authentication | jsonwebtoken | 9.0.2 |
| Password hashing | bcryptjs | 3.0.2 |
| Database | MySQL | 9.3.0 |
