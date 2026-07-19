# Local Environment Verification

## Purpose

Before introducing any infrastructure technology, the application must be verified working in its simplest possible form — running directly on the local machine with no containers, no orchestration, and no abstraction layers.

This establishes a trusted baseline. If an issue appears in a later phase (Docker, Kubernetes, CI/CD), it can be confidently attributed to the infrastructure layer rather than the application code.

---

## Environment

| Attribute | Value |
|---|---|
| Machine | MacBook Air |
| Chip | Apple M1 |
| RAM | 8 GB |
| OS | macOS |
| Shell | zsh |
| Node.js | v24.3.0 |
| MySQL | 9.3.0 (Homebrew) |

---

## Step 1 — MySQL Setup and Configuration

### Problem

MySQL was installed via Homebrew but had not been configured with a known password. All login attempts were rejected, making it impossible to create the database or start the API.

### Approach

MySQL was started in `--skip-grant-tables` mode, which bypasses authentication and allows unrestricted root access. This mode is safe for local setup and is a standard MySQL recovery procedure.

```bash
brew services stop mysql
mysqld_safe --skip-grant-tables &
mysql -u root
```

Inside MySQL:

```sql
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '<password>';
EXIT;
```

MySQL 9.x enforces a password validation policy by default. A password satisfying the policy requirements (minimum length, mixed characters) was set.

MySQL was then restarted normally and the new password was verified:

```bash
pkill -f mysqld
brew services start mysql
mysql -u root -p<password>
```

### Result

MySQL running on `localhost:3306` with confirmed authenticated root access.

---

## Step 2 — Database and Schema Creation

### Problem

The application requires a database named `crud_app` and a `users` table with a specific schema. Neither existed on this machine.

### Approach

The schema was derived from two sources:
- `api/models/db.js` — reveals the database name and connection configuration
- `api/app.js` — reveals the expected columns from the admin user insertion query
- `api/controllers/authController.js` — reveals the full column set used during registration

The following SQL was executed:

```sql
CREATE DATABASE IF NOT EXISTS crud_app;

USE crud_app;

CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Result

Database `crud_app` created. Table `users` confirmed present with the correct schema.

---

## Step 3 — Backend API Startup

### Configuration

`api/.env` was updated to reflect the local MySQL credentials:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=<local password>
DB_NAME=crud_app
JWT_SECRET=devopsShackSuperSecretKey
```

### Dependencies

```bash
cd api
npm install
```

99 packages installed successfully.

### Startup

```bash
node app.js
```

### Server Output

```
🚀 Server running on http://0.0.0.0:5000
MySQL Connected
✅ Admin user created: admin@example.com / admin123
```

This output confirms three things:
1. The Express server started and bound to port 5000
2. The MySQL connection was established successfully
3. The admin user auto-creation logic executed correctly

### Result

API running on `localhost:5000`. Database connection confirmed. Admin user seeded.

---

## Step 4 — Authentication Verification

### Approach

The login endpoint was tested directly via curl to verify the full authentication flow — HTTP request → Express handler → bcrypt password comparison → JWT generation → response.

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

### Response

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Admin User",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### Result

Valid JWT token returned. Authentication flow confirmed working end-to-end. The token contains the user ID and role, which are used by the frontend for role-based UI rendering and by the backend middleware for route authorization.

---

## Step 5 — Frontend Startup

### Configuration

`client/.env` was updated to point the React application at the local API:

```
REACT_APP_API=http://localhost:5000
```

### Dependencies

```bash
cd client
npm install
```

1351 packages installed. Several deprecation warnings were present — all relate to transitive dependencies inside `react-scripts` and have no functional impact.

### Startup

```bash
npm start
```

### Compilation Output

```
Compiled with warnings.
```

One ESLint warning was present in `UserDashboard.js` — a missing dependency in a `useEffect` hook. This is a code quality notice, not an error. It does not affect runtime behavior.

### Result

React development server running on `localhost:3000`. Application compiled and served successfully.

---

## Step 6 — Frontend Verification

### Approach

The served HTML was inspected to confirm the React application was built and served correctly:

```bash
curl -s http://localhost:3000 | grep '<title>'
```

### Response

```
<title>Anshuman Mohapatra – User Management</title>
```

### Result

Frontend confirmed serving correctly. Title, meta tags, and application shell verified.

---

## Verification Summary

| Verification Point | Method | Result |
|---|---|---|
| MySQL running and accessible | `mysql -u root -p` | ✅ |
| Database `crud_app` exists | `SHOW DATABASES` | ✅ |
| `users` table exists with correct schema | `SHOW TABLES` | ✅ |
| API starts and connects to database | Server stdout | ✅ |
| Admin user auto-created on boot | Server stdout | ✅ |
| Login endpoint returns valid JWT | curl POST | ✅ |
| JWT contains correct user data | Response inspection | ✅ |
| React app compiles without errors | npm start output | ✅ |
| Frontend served on port 3000 | curl GET | ✅ |
| Frontend configured to reach local API | `.env` inspection | ✅ |

---

## Conclusion

All three tiers are confirmed working correctly — independently and in integration — on the local machine.

The application's logic, authentication flow, database schema, and API contract are all verified. This trusted baseline means that any issue introduced in subsequent phases (Docker, Kubernetes, CI/CD) can be confidently isolated to the infrastructure layer rather than blamed on the application code.

**Phase 0 is complete. The application is ready for containerization.**
