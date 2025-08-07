const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const app = express();
const { PORT, TIMEOUTS, LOGGING } = require('../config');

const DB_PATH = path.join(__dirname, '../db/db.json');
const LOG_PATH = path.join(__dirname, '../logs/errors.log');

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(express.static(path.join(__dirname, '../public')));

// Enhanced data structure
const initialDB = {
  instances: {},
  users: {},
  statistics: {
    totalConnections: 0,
    currentConnections: 0,
    peakConnections: 0,
    disconnections: 0,
    totalMessages: 0,
    dailyActive: {},
    userAgents: {}
  },
  settings: {
    version: "1.2.0",
    createdAt: new Date().toISOString()
  }
};

const logError = async (message, ip) => {
  if (LOGGING.enable) {
    const log = `[${new Date().toISOString()}] [${ip}] ${message}\n`;
    await fs.appendFile(LOG_PATH, log).catch(() => {});
  }
};

const loadDB = async () => {
  try {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    await saveDB(initialDB);
    return initialDB;
  }
};

const saveDB = async (data) => {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    await logError(`DB write error: ${e.message}`, 'SYSTEM');
  }
};

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Connection tracking
app.post('/api/connect', async (req, res) => {
  const { instanceId, userId, userAgent = 'Unknown' } = req.body;
  const ip = req.ip;
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  if (!instanceId) {
    await logError('Missing instanceId', ip);
    return res.status(400).json({ error: 'instanceId required' });
  }

  const db = await loadDB();
  
  // Instance management
  if (!db.instances[instanceId]) {
    db.instances[instanceId] = {
      firstSeen: now,
      lastActive: now,
      status: 'connected',
      userAgent,
      ipAddress: ip,
      userId
    };
    db.statistics.totalConnections += 1;
  } else {
    db.instances[instanceId].lastActive = now;
    db.instances[instanceId].status = 'connected';
  }

  // User management
  if (userId && !db.users[userId]) {
    db.users[userId] = {
      firstSeen: now,
      lastActive: now,
      instances: [instanceId]
    };
  }

  // Statistics
  db.statistics.userAgents[userAgent] = (db.statistics.userAgents[userAgent] || 0) + 1;
  db.statistics.dailyActive[today] = (db.statistics.dailyActive[today] || 0) + 1;
  
  // Update connection counts
  updateConnectionStats(db, now);

  await saveDB(db);
  res.json({ success: true });
});

// Disconnection tracking
app.post('/api/disconnect', async (req, res) => {
  const { instanceId } = req.body;
  const now = Date.now();

  if (!instanceId) {
    return res.status(400).json({ error: 'instanceId required' });
  }

  const db = await loadDB();
  
  if (db.instances[instanceId]) {
    db.instances[instanceId].status = 'disconnected';
    db.instances[instanceId].lastActive = now;
    db.statistics.disconnections += 1;
    updateConnectionStats(db, now);
  }

  await saveDB(db);
  res.json({ success: true });
});

// Message tracking
app.post('/api/track', async (req, res) => {
  const { instanceId, userId } = req.body;
  const now = Date.now();

  if (!instanceId || !userId) {
    return res.status(400).json({ error: 'instanceId and userId required' });
  }

  const db = await loadDB();
  
  // Update user activity
  if (!db.users[userId]) {
    db.users[userId] = {
      firstSeen: now,
      lastActive: now,
      instances: [instanceId]
    };
  } else {
    db.users[userId].lastActive = now;
    if (!db.users[userId].instances.includes(instanceId)) {
      db.users[userId].instances.push(instanceId);
    }
  }

  // Update instance activity
  if (db.instances[instanceId]) {
    db.instances[instanceId].lastActive = now;
  }

  // Update message count
  db.statistics.totalMessages += 1;

  await saveDB(db);
  res.json({ success: true });
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  res.json({
    totalInstances: Object.keys(db.instances).length,
    activeInstances: Object.values(db.instances).filter(i => 
      i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent
    ).length,
    inactiveInstances: Object.values(db.instances).filter(i => 
      i.status !== 'connected' || (now - i.lastActive) >= TIMEOUTS.concurrent
    ).length,
    totalUsers: Object.keys(db.users).length,
    activeUsers: Object.values(db.users).filter(u => 
      (now - u.lastActive) < TIMEOUTS.concurrent
    ).length,
    statistics: db.statistics,
    lastUpdate: new Date().toISOString()
  });
});

// Get instance details
app.get('/api/instances', async (req, res) => {
  const db = await loadDB();
  res.json({
    instances: db.instances,
    total: Object.keys(db.instances).length
  });
});

// Get user details
app.get('/api/users', async (req, res) => {
  const db = await loadDB();
  res.json({
    users: db.users,
    total: Object.keys(db.users).length
  });
});

// Helper function to update connection stats
function updateConnectionStats(db, now) {
  db.statistics.currentConnections = Object.values(db.instances)
    .filter(i => i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent)
    .length;
    
  if (db.statistics.currentConnections > db.statistics.peakConnections) {
    db.statistics.peakConnections = db.statistics.currentConnections;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});