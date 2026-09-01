const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');

const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const db = require('./models/db'); // MySQL connection

const app = express();

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/auth', authRoutes);    // 🔐 Login/Register
app.use('/api/users', userRoutes);   // 👤 User management

// ─────────────────────────────────────────────────────
// Health endpoint — used by Kubernetes readiness and liveness probes
//
// Readiness probe: confirms the server is running AND MySQL is reachable.
// A pod passes readiness only when this endpoint returns 200.
// Until it does, Kubernetes keeps the pod out of the Service's endpoint
// list — no traffic is routed to it.
//
// Liveness probe: confirms the process has not entered a broken state.
// If this endpoint stops responding, Kubernetes restarts the container.
//
// Why check MySQL here:
//   The backend is only useful if it can reach the database. A pod where
//   Express is running but MySQL is unreachable would accept requests and
//   return 500s on every DB operation. The readiness probe prevents this
//   by keeping such a pod out of rotation until the DB connection is healthy.
// ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  db.query('SELECT 1', (err) => {
    if (err) {
      console.error('❌ Health check failed — DB unreachable:', err.message);
      return res.status(503).json({
        status: 'unhealthy',
        database: 'unreachable',
        error: err.message
      });
    }
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      version: '2.0.0'
    });
  });
});

// Auto-create or reset admin user
const initAdminUser = async () => {
  const name = 'Admin User';
  const email = 'admin@example.com';
  const password = 'admin123';
  const role = 'admin';
  const saltRounds = 10;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('❌ Error checking admin existence:', err);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    if (results.length === 0) {
      // Insert new admin
      db.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [name, email, hashedPassword, role],
        (err, result) => {
          if (err) return console.error('❌ Failed to insert admin:', err);
          console.log(`✅ Admin user created: ${email} / ${password}`);
        }
      );
    } else {
      // Optionally reset password if RESET_ADMIN_PASS=true
      if (process.env.RESET_ADMIN_PASS === 'true') {
        db.query(
          'UPDATE users SET password = ?, name = ?, role = ? WHERE email = ?',
          [hashedPassword, name, role, email],
          (err, result) => {
            if (err) return console.error('❌ Failed to reset admin password:', err);
            console.log(`🔁 Admin password reset to: ${password}`);
          }
        );
      } else {
        console.log('✅ Admin user already exists.');
      }
    }
  });
};

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  initAdminUser(); // 👤 Ensure admin exists on boot
});

