const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { body, validationResult } = require('express-validator');
const app = express();
const { PORT, TIMEOUTS, LOGGING } = require('../config');

const DB_PATH = path.join(__dirname, '../db/db.json');
const DB_BACKUP_PATH = path.join(__dirname, '../db/backups');
const LOG_PATH = path.join(__dirname, '../logs/errors.log');

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
    dailyDisconnections: {},
    userAgents: {},
    messageTypes: {},
    groupEvents: {},
    statusUpdates: {},
    messageReactions: {},
    errors: {},
    systemInfo: {}
  },
  settings: {
    version: "2.0.0",
    createdAt: new Date().toISOString(),
    lastMaintenance: null
  }
};

// Middleware setup
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(express.static(path.join(__dirname, '../public')));
app.use(compression());

// Rate limiting

// Trust Render's proxy

// Enhanced logging
const logError = async (message, ip, stack = '') => {
  if (LOGGING.enable) {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${ip}] ${message}\n${stack}\n\n`;
    await fs.appendFile(LOG_PATH, log).catch(() => {});
    
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[${timestamp}] [${ip}] ${message}`);
      if (stack) console.error(stack);
    }
  }
};

// Database functions
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
    await logError(`DB write error: ${e.message}`, 'SYSTEM', e.stack);
  }
};

const ensurePersistentData = async () => {
  try {
    await fs.mkdir(DB_BACKUP_PATH, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const backupFile = path.join(DB_BACKUP_PATH, `db_${today}.json`);
    
    const db = await loadDB();
    await fs.writeFile(backupFile, JSON.stringify(db, null, 2));
    
    // Data retention (keep 30 days)
    const files = await fs.readdir(DB_BACKUP_PATH);
    const oldFiles = files.filter(f => f.startsWith('db_') && f.endsWith('.json'))
      .sort()
      .slice(0, -30);
    
    for (const file of oldFiles) {
      await fs.unlink(path.join(DB_BACKUP_PATH, file));
    }
    
    db.settings.lastMaintenance = new Date().toISOString();
    await saveDB(db);
  } catch (e) {
    await logError(`DB maintenance error: ${e.message}`, 'SYSTEM', e.stack);
  }
};

// Run maintenance every hour
setInterval(ensurePersistentData, 3600000);

// Helper functions
function updateConnectionStats(db, now) {
  db.statistics.currentConnections = Object.values(db.instances)
    .filter(i => i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent)
    .length;
    
  if (db.statistics.currentConnections > db.statistics.peakConnections) {
    db.statistics.peakConnections = db.statistics.currentConnections;
  }
}

function getDailyKey() {
  return new Date().toISOString().split('T')[0];
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Enhanced connection tracking
app.post('/api/connect', 
  [
    body('userId').isString().notEmpty(),
    body('userAgent').optional().isString(),
    body('instanceId').optional().isString()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, userAgent = 'Unknown' } = req.body;
    const ip = req.ip;
    const now = Date.now();
    const today = getDailyKey();

    const db = await loadDB();
    
    // Generate unique instance ID if not provided
    let instanceId = req.body.instanceId;
    if (!instanceId || db.instances[instanceId]) {
      instanceId = `marxbot_${Object.keys(db.instances).length + 1}`;
    }

    // Instance management
    if (!db.instances[instanceId]) {
      db.instances[instanceId] = {
        id: instanceId,
        firstSeen: now,
        lastActive: now,
        status: 'connected',
        userAgent,
        ipAddress: ip,
        userId,
        connectionCount: 1,
        lastDisconnect: null
      };
      db.statistics.totalConnections += 1;
    } else {
      db.instances[instanceId].lastActive = now;
      db.instances[instanceId].status = 'connected';
      db.instances[instanceId].connectionCount += 1;
    }

    // User management
    if (!db.users[userId]) {
      db.users[userId] = {
        id: userId,
        firstSeen: now,
        lastActive: now,
        instances: [instanceId],
        totalMessages: 0,
        totalReactions: 0
      };
    } else if (!db.users[userId].instances.includes(instanceId)) {
      db.users[userId].instances.push(instanceId);
    }

    // Statistics
    db.statistics.userAgents[userAgent] = (db.statistics.userAgents[userAgent] || 0) + 1;
    db.statistics.dailyActive[today] = (db.statistics.dailyActive[today] || 0) + 1;
    
    updateConnectionStats(db, now);

    await saveDB(db);
    res.json({ success: true, instanceId });
  }
);

// Enhanced disconnection tracking
app.post('/api/disconnect-instances', 
  [
    body('instanceId').isString().notEmpty(),
    body('reason').optional().isString()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId, reason = 'unknown' } = req.body;
    const now = Date.now();
    const today = getDailyKey();

    const db = await loadDB();
    
    if (db.instances[instanceId]) {
      db.instances[instanceId].status = 'disconnected';
      db.instances[instanceId].lastActive = now;
      db.instances[instanceId].lastDisconnect = {
        timestamp: now,
        reason
      };
      db.statistics.disconnections += 1;
      db.statistics.dailyDisconnections[today] = (db.statistics.dailyDisconnections[today] || 0) + 1;
      updateConnectionStats(db, now);
    }

    await saveDB(db);
    res.json({ success: true });
  }
);

// Enhanced message tracking
app.post('/api/track', 
  [
    body('instanceId').isString().notEmpty(),
    body('userId').isString().notEmpty(),
    body('messageId').optional().isString(),
    body('messageType').optional().isString(),
    body('eventType').optional().isString()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId, userId, messageId, messageType, eventType } = req.body;
    const now = Date.now();

    const db = await loadDB();
    
    // Update user activity
    if (!db.users[userId]) {
      db.users[userId] = {
        id: userId,
        firstSeen: now,
        lastActive: now,
        instances: [instanceId],
        totalMessages: 0,
        totalReactions: 0
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

    // Handle different event types
    if (eventType === 'message') {
      db.statistics.totalMessages += 1;
      db.users[userId].totalMessages += 1;
      
      if (messageType) {
        db.statistics.messageTypes[messageType] = (db.statistics.messageTypes[messageType] || 0) + 1;
      }
    } 
    else if (eventType === 'group_update') {
      const { action, groupId } = req.body;
      const key = `${action}_${groupId}`;
      db.statistics.groupEvents[key] = (db.statistics.groupEvents[key] || 0) + 1;
    }
    else if (eventType === 'status_update') {
      const { status } = req.body;
      db.statistics.statusUpdates[status] = (db.statistics.statusUpdates[status] || 0) + 1;
    }
    else if (eventType === 'message_reaction') {
      const { reaction } = req.body;
      db.statistics.messageReactions[reaction] = (db.statistics.messageReactions[reaction] || 0) + 1;
      db.users[userId].totalReactions += 1;
    }
    else if (eventType === 'heartbeat') {
      // Just update lastActive without counting as message
    }

    await saveDB(db);
    res.json({ success: true });
  }
);

// System info endpoint
app.post('/api/system-info', 
  [
    body('instanceId').isString().notEmpty(),
    body('systemInfo').isObject()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId, systemInfo } = req.body;
    const now = Date.now();

    const db = await loadDB();
    
    if (db.instances[instanceId]) {
      db.instances[instanceId].systemInfo = systemInfo;
      db.statistics.systemInfo[instanceId] = {
        ...systemInfo,
        lastUpdated: now
      };
    }

    await saveDB(db);
    res.json({ success: true });
  }
);

// Error tracking endpoint
// Add this error endpoint (before app.listen)
app.get('/api/errors', async (req, res) => {
  try {
    const db = await loadDB();
    const errors = [];
    
    // Get disconnection errors from instances
    Object.values(db.instances).forEach(instance => {
      if (instance.lastDisconnect) {
        errors.push({
          instanceId: instance.id,
          errorType: 'disconnection',
          message: `Disconnected: ${instance.lastDisconnect.reason}`,
          timestamp: instance.lastDisconnect.timestamp
        });
      }
    });

    // Get system errors from statistics
    Object.entries(db.statistics.errors || {}).forEach(([errorType, count]) => {
      errors.push({
        instanceId: 'system',
        errorType,
        message: `Error occurred ${count} time(s)`,
        timestamp: Date.now() - Math.random() * 86400000 // Random recent time
      });
    });

    res.json(errors.sort((a,b) => b.timestamp - a.timestamp).slice(0, 50));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enhanced statistics endpoint
app.get('/api/stats', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const activeInstances = Object.values(db.instances).filter(i => 
    i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent
  );
  
  const inactiveInstances = Object.values(db.instances).filter(i => 
    i.status !== 'connected' || (now - i.lastActive) >= TIMEOUTS.concurrent
  );
  
  res.json({
    totalInstances: Object.keys(db.instances).length,
    activeInstances: activeInstances.length,
    inactiveInstances: inactiveInstances.length,
    totalUsers: Object.keys(db.users).length,
    activeUsers: Object.values(db.users).filter(u => 
      (now - u.lastActive) < TIMEOUTS.concurrent
    ).length,
    statistics: db.statistics,
    connectionHealth: {
      uptime: process.uptime(),
      avgResponseTime: calculateAvgResponseTime(db),
      errorRate: calculateErrorRate(db),
      recentDisconnects: inactiveInstances
        .filter(i => (now - i.lastActive) < TIMEOUTS.disconnected)
        .sort((a, b) => b.lastActive - a.lastActive)
        .slice(0, 5)
    },
    lastUpdate: new Date().toISOString()
  });
});

function calculateAvgResponseTime(db) {
  // Implement your response time calculation logic
  return 0;
}

function calculateErrorRate(db) {
  const totalErrors = Object.values(db.statistics.errors).reduce((a, b) => a + b, 0);
  const totalRequests = db.statistics.totalConnections + db.statistics.totalMessages;
  return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
}

// Enhanced instance details endpoint
app.get('/api/instances', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const instances = Object.values(db.instances).map(instance => ({
    ...instance,
    isActive: instance.status === 'connected' && (now - instance.lastActive) < TIMEOUTS.concurrent,
    uptime: now - instance.firstSeen
  }));
  
  res.json({
    instances: instances.sort((a, b) => b.lastActive - a.lastActive),
    total: instances.length,
    active: instances.filter(i => i.isActive).length,
    inactive: instances.filter(i => !i.isActive).length
  });
});

// Enhanced user details endpoint
app.get('/api/users', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const users = Object.values(db.users).map(user => ({
    ...user,
    isActive: (now - user.lastActive) < TIMEOUTS.concurrent
  }));
  
  res.json({
    users: users.sort((a, b) => b.lastActive - a.lastActive),
    total: users.length,
    active: users.filter(u => u.isActive).length,
    inactive: users.filter(u => !u.isActive).length
  });
});

// Connection health endpoint
// Add this new endpoint before the server starts
app.get('/api/errors', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  // Collect all errors from instances
  const errors = Object.values(db.instances)
    .filter(i => i.lastDisconnect)
    .map(i => ({
      instanceId: i.id,
      errorType: i.lastDisconnect.reason,
      error: `Disconnected: ${i.lastDisconnect.reason}`,
      timestamp: i.lastDisconnect.timestamp
    }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50); // Return last 50 errors

  res.json(errors);
});

// Update the connection health endpoint to include more detailed status
app.get('/api/connection-health', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const instances = Object.values(db.instances);
  const activeInstances = instances.filter(i => 
    i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent
  );
  
  const inactiveInstances = instances.filter(i => 
    i.status !== 'connected' || (now - i.lastActive) >= TIMEOUTS.concurrent
  );
  
  const avgUptime = instances.reduce((sum, i) => {
    return sum + (i.lastActive - i.firstSeen);
  }, 0) / (instances.length || 1);
  
  const totalErrors = Object.values(db.statistics.errors).reduce((a, b) => a + b, 0);
  const totalRequests = db.statistics.totalConnections + db.statistics.totalMessages;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  
  res.json({
    activeCount: activeInstances.length,
    inactiveCount: inactiveInstances.length,
    avgUptime,
    errorRate,
    recentDisconnects: inactiveInstances
      .filter(i => (now - i.lastActive) < TIMEOUTS.disconnected)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, 5),
    healthStatus: activeInstances.length > 0 ? 'healthy' : 'critical'
  });
});

// Instance uptime endpoint
app.get('/api/instance/:id/uptime', async (req, res) => {
  const db = await loadDB();
  const instance = db.instances[req.params.id];
  
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  const now = Date.now();
  const uptime = now - instance.firstSeen;
  const lastSeen = new Date(instance.lastActive).toISOString();
  
  res.json({
    id: req.params.id,
    uptime,
    lastSeen,
    status: instance.status,
    connectionCount: instance.connectionCount || 1,
    systemInfo: instance.systemInfo || null
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dbStatus: 'connected',
    memoryUsage: process.memoryUsage()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  ensurePersistentData(); // Run initial maintenance
});