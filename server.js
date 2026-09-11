require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const requestedPort = Number(process.argv[2]) || Number(process.env.PORT) || 3000;
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
const defaultUsers = {
  passenger: { name: 'Passenger Demo', email: 'passenger@buspulse.com', password: 'bus123', role: 'passenger' },
  admin: { name: 'Admin Demo', email: 'admin@buspulse.com', password: 'admin123', role: 'admin' }
};

const memoryUsers = new Map();
Object.values(defaultUsers).forEach((user) => memoryUsers.set(user.email, user));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'buspulse',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

let dbReady = false;

async function initializeDatabase() {
  try {
    await pool.query('SELECT 1');
    dbReady = true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS crowd_reports (
        id SERIAL PRIMARY KEY,
        bus_number VARCHAR(20),
        stop_name VARCHAR(100),
        crowd_level VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    for (const user of Object.values(defaultUsers)) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rowCount === 0) {
        await pool.query(
          'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
          [user.name, user.email, user.password, user.role]
        );
      }
    }

    console.log('PostgreSQL connected and initialized.');
  } catch (error) {
    console.warn('PostgreSQL not available. Falling back to in-memory storage:', error.message);
    dbReady = false;
  }
}

async function findUserByEmail(email) {
  if (dbReady) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  return memoryUsers.get(email) || null;
}

async function createUser({ name, email, password, role }) {
  if (dbReady) {
    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, password, role]
    );
    return result.rows[0];
  }

  const user = { name, email, password, role };
  memoryUsers.set(email, user);
  return user;
}

function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname)));

  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      message: 'BusPulse backend is running.',
      database: dbReady ? 'postgresql' : 'memory'
    });
  });

  app.get('/api/buses', async (req, res) => {
    const busData = [
      { id: 1, number: '218', route: 'Ameerpet → Lakdikapul', currentStop: 'Ameerpet', eta: 5, occupancy: 56, predictedCrowd: 66 },
      { id: 2, number: '218', route: 'Ameerpet → Lakdikapul', currentStop: 'SR Nagar', eta: 13, occupancy: 62, predictedCrowd: 71 },
      { id: 3, number: '127K', route: 'Secunderabad → Hitech City', currentStop: 'Begumpet', eta: 9, occupancy: 78, predictedCrowd: 84 },
      { id: 4, number: '216', route: 'Koti → Gachibowli', currentStop: 'Punjagutta', eta: 17, occupancy: 49, predictedCrowd: 58 }
    ];

    res.json({ success: true, buses: busData });
  });

  app.post('/api/assistant', async (req, res) => {
    try {
      const { question = '', fromStop = 'Ameerpet', destination = 'Lakdikapul' } = req.body || {};
      const cleaned = String(question || '').trim();
      const lower = cleaned.toLowerCase();
      const busData = [
        { id: 1, number: '218', route: 'Ameerpet → Lakdikapul', currentStop: 'Ameerpet', eta: 5, occupancy: 56, predictedCrowd: 66 },
        { id: 2, number: '218', route: 'Ameerpet → Lakdikapul', currentStop: 'SR Nagar', eta: 13, occupancy: 62, predictedCrowd: 71 },
        { id: 3, number: '127K', route: 'Secunderabad → Hitech City', currentStop: 'Begumpet', eta: 9, occupancy: 78, predictedCrowd: 84 },
        { id: 4, number: '216', route: 'Koti → Gachibowli', currentStop: 'Punjagutta', eta: 17, occupancy: 49, predictedCrowd: 58 }
      ];

      const best = [...busData].sort((a, b) => a.predictedCrowd - b.predictedCrowd)[0];
      const avgCrowd = Math.round(busData.reduce((sum, bus) => sum + bus.predictedCrowd, 0) / busData.length);

      let reply = `I can help with route and crowding advice. For example, ask “Which bus is least crowded?” or “What should I take from ${fromStop} to ${destination}?”`;

      if (!cleaned) {
        reply = 'Please tell me what you want to know about your route, crowding, or bus choice.';
      } else if (lower.includes('least crowded') || lower.includes('best bus') || lower.includes('comfortable') || lower.includes('empty')) {
        reply = `The most comfortable option right now is Bus ${best.number}. It is on the ${best.route} route, arrives in about ${best.eta} minutes, and is predicted to be around ${best.predictedCrowd}% full.`;
      } else if (lower.includes('from') || lower.includes('to') || lower.includes('route') || lower.includes('destination')) {
        reply = `From ${fromStop} to ${destination}, I’d suggest Bus ${best.number}. It balances speed and comfort better than most buses right now, with an arrival time of about ${best.eta} minutes and a crowd estimate of ${best.predictedCrowd}%.`;
      } else if (lower.includes('crowd') || lower.includes('busy') || lower.includes('packed')) {
        reply = `Current city load is about ${avgCrowd}%, and the busiest window is usually between 5 PM and 6 PM. For a smoother ride, choose Bus ${best.number}, which is currently the least crowded strong option.`;
      } else if (lower.includes('delay') || lower.includes('late') || lower.includes('eta') || lower.includes('arrive')) {
        reply = `The fastest recommended option is Bus ${best.number}. It is expected to arrive in about ${best.eta} minutes, which is better than most nearby buses right now.`;
      } else if (lower.includes('help') || lower.includes('doubt') || lower.includes('clarify')) {
        reply = "I can help with route choice, crowding levels, bus timing, and the best option to board. Ask me something like: ‘Which bus is least crowded?’ or ‘What should I take from Ameerpet to Hitech City?’";
      }

      return res.json({ success: true, reply });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Unable to generate assistant response.' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { email, password, role } = req.body || {};
      if (!email || !password || !role) {
        return res.status(400).json({ success: false, message: 'Email, password, and role are required.' });
      }

      const user = await findUserByEmail(email);
      if (!user || user.password !== password || user.role !== role) {
        return res.status(401).json({ success: false, message: 'Invalid credentials for the selected role.' });
      }

      return res.json({
        success: true,
        message: 'Login successful',
        user: { email: user.email, role: user.role, name: user.name || 'User' }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Login failed due to a server error.' });
    }
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { name, email, password, role } = req.body || {};
      if (!name || !email || !password || !role) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
      }

      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const newUser = await createUser({ name, email, password, role });

      return res.status(201).json({
        success: true,
        message: 'Account created successfully.',
        user: { name: newUser.name, email: newUser.email, role: newUser.role }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Account creation failed due to a server error.' });
    }
  });

  app.post('/api/reports', async (req, res) => {
    try {
      const { busNumber, stopName, crowdLevel } = req.body || {};

      if (!busNumber || !stopName || !crowdLevel) {
        return res.status(400).json({ success: false, message: 'Bus number, stop name, and crowd level are required.' });
      }

      if (dbReady) {
        await pool.query(
          'INSERT INTO crowd_reports (bus_number, stop_name, crowd_level) VALUES ($1, $2, $3)',
          [busNumber, stopName, crowdLevel]
        );
      }

      return res.json({
        success: true,
        message: 'Crowd report saved successfully.',
        report: { busNumber, stopName, crowdLevel }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Unable to save crowd report.' });
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('*', (req, res) => {
    const filePath = path.join(__dirname, req.path.replace(/^\//, ''));
    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).send('Not found');
      }
    });
  });

  return app;
}

if (require.main === module) {
  initializeDatabase().then(() => {
    const app = buildApp();
    app.listen(PORT, () => {
      console.log(`BusPulse server running at http://localhost:${PORT}`);
    });
  });
}

module.exports = { buildApp, initializeDatabase, pool, defaultUsers };
