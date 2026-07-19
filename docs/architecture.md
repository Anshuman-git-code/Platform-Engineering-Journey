# Application Architecture

## Overview

The application follows a three-tier architecture with strict separation between presentation, application logic, and data storage. Each tier has a single, well-defined responsibility and communicates with adjacent tiers through defined interfaces.

---

## Tier Diagram

```
┌─────────────────────────────────────────┐
│             PRESENTATION TIER            │
│                                         │
│   React.js (port 3000)                  │
│   - Renders UI                          │
│   - Manages user interaction            │
│   - Sends HTTP requests via Axios       │
│   - Stores JWT in memory via Context    │
└───────────────────┬─────────────────────┘
                    │  HTTP (JSON)
                    │  Authorization: Bearer <JWT>
┌───────────────────▼─────────────────────┐
│            APPLICATION TIER             │
│                                         │
│   Node.js + Express (port 5000)         │
│   - Validates incoming requests         │
│   - Enforces authentication (JWT)       │
│   - Enforces authorization (roles)      │
│   - Executes business logic             │
│   - Hashes passwords (bcrypt)           │
│   - Issues JWT tokens                   │
│   - Communicates with database          │
└───────────────────┬─────────────────────┘
                    │  SQL (mysql2 driver)
                    │  Connection pool
┌───────────────────▼─────────────────────┐
│               DATA TIER                 │
│                                         │
│   MySQL (port 3306)                     │
│   - Stores user records                 │
│   - Enforces data integrity constraints │
│   - Runs as an external service         │
└─────────────────────────────────────────┘
```

---

## Data Flow

### Authentication Flow

```
1. User submits login form (React)
2. Axios sends POST /api/auth/login with email + password
3. Express receives request
4. authController queries MySQL for user by email
5. bcrypt compares submitted password against stored hash
6. On success: JWT signed with user ID and role, returned to client
7. React stores token in AuthContext
8. All subsequent requests include token in Authorization header
```

### Protected Resource Flow

```
1. React component mounts, Axios sends GET /api/users
2. Axios interceptor attaches JWT to Authorization header
3. Express auth middleware intercepts request
4. JWT verified — invalid or expired tokens rejected with 401
5. Role middleware checks user role against required permission
6. Controller executes query, returns data
7. React renders response
```

---

## Component Responsibilities

### Frontend (`client/`)

| Component | Responsibility |
|---|---|
| `AuthContext.js` | Global auth state — token, user object, login/logout/register functions |
| `axios.js` | Configured Axios instance with JWT interceptor |
| `ProtectedRoute.js` | Redirects unauthenticated users away from protected pages |
| `UserDashboard.js` | Main application view — user list, create, edit, delete |
| `Login.js` / `Register.js` | Authentication forms |
| `Layout.js` | Shell — header, sidebar, footer, background elements |

### Backend (`api/`)

| Component | Responsibility |
|---|---|
| `app.js` | Application entry point — middleware registration, route mounting, server startup, admin seeding |
| `models/db.js` | MySQL connection pool — database communication layer |
| `routes/authRoutes.js` | Route definitions for authentication endpoints |
| `routes/userRoutes.js` | Route definitions for user management endpoints |
| `controllers/authController.js` | Login and registration business logic |
| `controllers/userController.js` | User CRUD business logic |
| `middleware/auth.js` | JWT verification on protected routes |
| `middleware/role.js` | Role-based access control enforcement |

---

## Authorization Model

| Role | Permissions |
|---|---|
| `admin` | Full access — read, create, update, delete all users |
| `viewer` | Read access — can view users and create new viewer accounts |

Role is stored in the database and embedded in the JWT payload. The backend enforces role checks on every relevant endpoint. The frontend adjusts the UI based on role but does not rely on this for security — enforcement is always server-side.

---

## Database Schema

**Table: `users`**

| Column | Type | Constraints |
|---|---|---|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT |
| `name` | VARCHAR(255) | NOT NULL |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE |
| `password` | VARCHAR(255) | NOT NULL (bcrypt hash) |
| `role` | ENUM('admin','viewer') | NOT NULL, DEFAULT 'viewer' |
| `is_active` | TINYINT(1) | DEFAULT 1 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

## Port Map

| Service | Port | Protocol |
|---|---|---|
| React dev server | 3000 | HTTP |
| Express API | 5000 | HTTP |
| MySQL | 3306 | TCP |

---

## Key Architectural Properties

**Loose coupling** — each tier communicates only through defined interfaces (HTTP, SQL). No tier has direct access to another tier's internals.

**Stateless API** — the Express API holds no session state. All authentication state lives in the JWT, which is owned by the client. This is a prerequisite for horizontal scaling.

**Environment-driven configuration** — all environment-specific values (database credentials, JWT secret, API URL) are externalized via `.env` files. The application code contains no hardcoded credentials.

**Role-based access control** — authorization is enforced at the API layer regardless of what the frontend sends. The frontend UI adjusts to role for usability, not for security.
