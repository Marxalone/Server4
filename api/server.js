const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { body, validationResult } = require('express-validator');
const app = express();
//


// ✅ Trust the first proxy (needed for express-rate-limit behind proxies)
app.set('trust proxy', 1);

// Your other middleware

// Rest of your code...
// Configuration - moved to top for better visibility
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TIMEOUTS: {
    concurrent: 5 * 60 * 1000,    // 5 minutes for concurrent activity
    disconnected: 24 * 60 * 60 * 1000, // 24 hours for full disconnection
    heartbeat: 2 * 60 * 1000      // 2 minutes for heartbeat timeout
  },
  LOGGING: {
    enable: true
  },
  RATE_LIMIT: {
    windowMs: 95 * 60 * 1000,     // 15 minutes
    max: 10000                       // limit each IP to 100 requests per windowMs
  }
};

const DB_PATH = path.join(__dirname, '../db/db.json');
const DB_BACKUP_PATH = path.join(__dirname, '../db/backups');
const LOG_PATH = path.join(__dirname, '../logs/errors.log');
const INSTANCE_STORAGE_PATH = path.join(__dirname, '../data/instance_storage.json');

// Enhanced data structure with heartbeat tracking
const initialDB = {
  instances: {},
  users: {},
  statistics: {
    totalConnections: 0,
    currentConnections: 0,
    peakConnections: 0,
    disconnections: 0,
    reconnections: 0,
    totalMessages: 0,
    dailyActive: {},
    dailyDisconnections: {},
    userAgents: {},
    messageTypes: {},
    groupEvents: {},
    statusUpdates: {},
    messageReactions: {},
    errors: {},
    systemInfo: {},
    heartbeats: 0
  },
  settings: {
    version: "2.1.0",  // Updated version
    createdAt: new Date().toISOString(),
    lastMaintenance: null
  }
};

const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.windowMs,
  max: CONFIG.RATE_LIMIT.max
});
app.use(limiter);


// Middleware setup
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(express.static(path.join(__dirname, '../public')));
app.use(compression());

// Rate limiting

// Enhanced logging
const logError = async (message, ip, stack = '') => {
  if (CONFIG.LOGGING.enable) {
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

// Instance ID storage functions
const loadInstanceStorage = async () => {
  try {
    if (fs.existsSync(INSTANCE_STORAGE_PATH)) {
      const data = await fs.readFile(INSTANCE_STORAGE_PATH, 'utf8');
      return JSON.parse(data);
    }
    return {};
  } catch (e) {
    await logError(`Instance storage load error: ${e.message}`, 'SYSTEM', e.stack);
    return {};
  }
};

const saveInstanceStorage = async (data) => {
  try {
    await fs.mkdir(path.dirname(INSTANCE_STORAGE_PATH), { recursive: true });
    await fs.writeFile(INSTANCE_STORAGE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    await logError(`Instance storage save error: ${e.message}`, 'SYSTEM', e.stack);
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
      await fs.unlink(path.join(DB_BACKUP_PATH, file)).catch(() => {});
    }
    
    db.settings.lastMaintenance = new Date().toISOString();
    await saveDB(db);
  } catch (e) {
    await logError(`DB maintenance error: ${e.message}`, 'SYSTEM', e.stack);
  }
};

// Cleanup inactive instances
const cleanupInactiveInstances = async () => {
  try {
    const db = await loadDB();
    const now = Date.now();
    let removedCount = 0;

    Object.entries(db.instances).forEach(([id, instance]) => {
      if ((now - instance.lastActive) > CONFIG.TIMEOUTS.disconnected) {
        delete db.instances[id];
        removedCount++;
      }
    });

    if (removedCount > 0) {
      await saveDB(db);
      console.log(`Cleaned up ${removedCount} inactive instances`);
    }
  } catch (e) {
    await logError(`Instance cleanup error: ${e.message}`, 'SYSTEM', e.stack);
  }
};

// Run maintenance every hour
setInterval(ensurePersistentData, 172800000);
// Run cleanup every 6 hours
setInterval(cleanupInactiveInstances, 6 * 172800000);

// Helper functions
function updateConnectionStats(db, now) {
  db.statistics.currentConnections = Object.values(db.instances)
    .filter(i => i.status === 'connected' && 
          (now - i.lastActive) < CONFIG.TIMEOUTS.concurrent &&
          (now - (i.lastHeartbeat || 0)) < CONFIG.TIMEOUTS.heartbeat)
    .length;
    
  if (db.statistics.currentConnections > db.statistics.peakConnections) {
    db.statistics.peakConnections = db.statistics.currentConnections;
  }
}

function getDailyKey() {
  return new Date().toISOString().split('T')[0];
}

function calculateAvgResponseTime(db) {
  // Implement your response time calculation logic
  return 0;
}

function calculateErrorRate(db) {
  const totalErrors = Object.values(db.statistics.errors).reduce((a, b) => a + b, 0);
  const totalRequests = db.statistics.totalConnections + db.statistics.totalMessages;
  return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Enhanced connection tracking with persistent instance IDs
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
    const instanceStorage = await loadInstanceStorage();
    
    // Try to find existing instance ID for this user
    let instanceId = req.body.instanceId;
    if (!instanceId && instanceStorage[userId]) {
      instanceId = instanceStorage[userId];
    }

    // If no existing ID or it's not in DB, generate new one
    if (!instanceId || !db.instances[instanceId]) {
      instanceId = `marxbot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      instanceStorage[userId] = instanceId;
      await saveInstanceStorage(instanceStorage);
    }

    // Instance management
    if (!db.instances[instanceId]) {
      db.instances[instanceId] = {
        id: instanceId,
        firstSeen: now,
        lastActive: now,
        lastHeartbeat: now,
        status: 'connected',
        userAgent,
        ipAddress: ip,
        userId,
        connectionCount: 1,
        lastDisconnect: null,
        systemInfo: null
      };
      db.statistics.totalConnections += 1;
    } else {
      // Update existing instance
      const wasDisconnected = db.instances[instanceId].status === 'disconnected';
      db.instances[instanceId].lastActive = now;
      db.instances[instanceId].lastHeartbeat = now;
      db.instances[instanceId].status = 'connected';
      db.instances[instanceId].connectionCount += 1;
      
      if (wasDisconnected) {
        db.statistics.reconnections += 1;
      }
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

// Heartbeat endpoint
app.post('/api/heartbeat', 
  [
    body('instanceId').isString().notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId } = req.body;
    const now = Date.now();

    const db = await loadDB();
    
    if (db.instances[instanceId]) {
      db.instances[instanceId].lastHeartbeat = now;
      db.instances[instanceId].lastActive = now;
      db.statistics.heartbeats = (db.statistics.heartbeats || 0) + 1;
      await saveDB(db);
    }

    res.json({ success: true });
  }
);

// Enhanced disconnection tracking
app.post('/api/disconnect', 
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
      if (db.instances[instanceId]) {
        db.instances[instanceId].lastHeartbeat = now;
        db.statistics.heartbeats = (db.statistics.heartbeats || 0) + 1;
      }
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
      db.instances[instanceId].lastHeartbeat = now;
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
    i.status === 'connected' && 
    (now - i.lastActive) < CONFIG.TIMEOUTS.concurrent &&
    (now - (i.lastHeartbeat || 0)) < CONFIG.TIMEOUTS.heartbeat
  );
  
  const inactiveInstances = Object.values(db.instances).filter(i => 
    i.status !== 'connected' || 
    (now - i.lastActive) >= CONFIG.TIMEOUTS.concurrent ||
    (now - (i.lastHeartbeat || 0)) >= CONFIG.TIMEOUTS.heartbeat
  );
  
  res.json({
    totalInstances: Object.keys(db.instances).length,
    activeInstances: activeInstances.length,
    inactiveInstances: inactiveInstances.length,
    totalUsers: Object.keys(db.users).length,
    activeUsers: Object.values(db.users).filter(u => 
      (now - u.lastActive) < CONFIG.TIMEOUTS.concurrent
    ).length,
    statistics: db.statistics,
    connectionHealth: {
      uptime: process.uptime(),
      avgResponseTime: calculateAvgResponseTime(db),
      errorRate: calculateErrorRate(db),
      recentDisconnects: inactiveInstances
        .filter(i => (now - i.lastActive) < CONFIG.TIMEOUTS.disconnected)
        .sort((a, b) => b.lastActive - a.lastActive)
        .slice(0, 5)
    },
    lastUpdate: new Date().toISOString()
  });
});

// Enhanced instance details endpoint
app.get('/api/instances', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const instances = Object.values(db.instances).map(instance => ({
    ...instance,
    isActive: instance.status === 'connected' && 
              (now - instance.lastActive) < CONFIG.TIMEOUTS.concurrent &&
              (now - (instance.lastHeartbeat || 0)) < CONFIG.TIMEOUTS.heartbeat,
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
    isActive: (now - user.lastActive) < CONFIG.TIMEOUTS.concurrent
  }));
  
  res.json({
    users: users.sort((a, b) => b.lastActive - a.lastActive),
    total: users.length,
    active: users.filter(u => u.isActive).length,
    inactive: users.filter(u => !u.isActive).length
  });
});

// Connection health endpoint
app.get('/api/connection-health', async (req, res) => {
  const db = await loadDB();
  const now = Date.now();
  
  const instances = Object.values(db.instances);
  const activeInstances = instances.filter(i => 
    i.status === 'connected' && 
    (now - i.lastActive) < CONFIG.TIMEOUTS.concurrent &&
    (now - (i.lastHeartbeat || 0)) < CONFIG.TIMEOUTS.heartbeat
  );
  
  const inactiveInstances = instances.filter(i => 
    i.status !== 'connected' || 
    (now - i.lastActive) >= CONFIG.TIMEOUTS.concurrent ||
    (now - (i.lastHeartbeat || 0)) >= CONFIG.TIMEOUTS.heartbeat
  );
  
  const avgUptime = instances.reduce((sum, i) => {
    return sum + (i.lastActive - i.firstSeen);
  }, 0) / (instances.length || 1);
  
  const totalErrors = Object.values(db.statistics.errors).reduce((a, b) => a + b, 0);
  const totalRequests = db.statistics.totalConnections + db.statistics.totalMessages;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  
  // Determine health status
  let healthStatus = 'healthy';
  if (activeInstances.length === 0) {
    healthStatus = 'critical';
  } else if (inactiveInstances.length > activeInstances.length) {
    healthStatus = 'degraded';
  }
  
  res.json({
    activeCount: activeInstances.length,
    inactiveCount: inactiveInstances.length,
    avgUptime,
    errorRate,
    recentDisconnects: inactiveInstances
      .filter(i => (now - i.lastActive) < CONFIG.TIMEOUTS.disconnected)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, 5),
    healthStatus
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
app.listen(CONFIG.PORT, () => {
  console.log(`✅ Server running at http://localhost:${CONFIG.PORT}`);
  ensurePersistentData(); // Run initial maintenance
  cleanupInactiveInstances(); // Initial cleanup
});