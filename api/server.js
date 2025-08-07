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

// Enhanced data structure with all new features
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
    userAgents: {},
    connectionEvents: [],
    sessionMetrics: {
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      failedConnections: 0
    },
    qualityMetrics: {
      stabilityScore: 100,
      healthScore: 100,
      connectionQuality: 100
    }
  },
  settings: {
    version: "1.3.0",
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

// Helper to detect connection quality issues
function detectConnectionQuality(instance, now) {
  const issues = [];
  
  // Detect frequent reconnections
  if (instance.connectionCount > 5 && 
      (now - instance.firstSeen) < 3600000) { // More than 5 reconnects in 1 hour
    issues.push('frequent_reconnections');
  }

  // Detect short sessions
  if (instance.avgSessionDuration < 30000) { // Less than 30s average
    issues.push('short_sessions');
  }

  // Detect IP changes (possible network issues)
  if (instance.ipHistory && instance.ipHistory.length > 1) {
    issues.push('ip_instability');
  }

  return issues.length > 0 ? issues : ['stable'];
}

function calculateHealthScore(instance) {
  let score = 100;
  
  // Deduct for quality issues
  if (instance.qualityIssues.includes('frequent_reconnections')) score -= 30;
  if (instance.qualityIssues.includes('short_sessions')) score -= 20;
  if (instance.qualityIssues.includes('ip_instability')) score -= 15;
  
  // Deduct for high disconnection rate
  const disconnectionRate = instance.disconnectionCount / instance.connectionCount;
  if (disconnectionRate > 0.3) score -= 20;
  
  // Deduct for short average sessions
  if (instance.avgSessionDuration < 60000) { // Less than 1 minute
    score -= (1 - (instance.avgSessionDuration / 60000)) * 15;
  }
  
  return Math.max(0, Math.round(score));
}

function generateRecommendations(instance) {
  const recs = [];
  
  if (instance.qualityIssues.includes('frequent_reconnections')) {
    recs.push('Check network stability and bot reconnection logic');
  }
  
  if (instance.qualityIssues.includes('short_sessions')) {
    recs.push('Investigate why sessions are ending prematurely');
  }
  
  if (instance.qualityIssues.includes('ip_instability')) {
    recs.push('Bot may be changing networks frequently - consider static IP');
  }
  
  if (instance.healthScore < 70) {
    recs.push('This instance needs attention - review connection logs');
  }
  
  return recs.length > 0 ? recs : ['No critical issues detected'];
}

function updateQualityMetrics(db) {
  // Calculate average session duration across all instances
  const instances = Object.values(db.instances);
  const durations = instances.flatMap(i => 
    i.sessions.filter(s => s.duration).map(s => s.duration)
  );
  
  if (durations.length > 0) {
    db.statistics.sessionMetrics = {
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      failedConnections: db.statistics.connectionEvents.filter(
        e => e.type === 'disconnection' && e.reason !== 'normal'
      ).length
    };
  }
  
  // Calculate overall quality metrics
  const healthScores = instances.map(i => i.healthScore);
  const avgHealthScore = healthScores.length > 0 
    ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
    : 100;
    
  db.statistics.qualityMetrics = {
    stabilityScore: calculateStabilityScore(db),
    healthScore: Math.round(avgHealthScore),
    connectionQuality: calculateConnectionQuality(db)
  };
}

function calculateConnectionQuality(db) {
  const totalSessions = db.statistics.connectionEvents.filter(
    e => e.type === 'connection'
  ).length;
  
  const failedSessions = db.statistics.connectionEvents.filter(
    e => e.type === 'disconnection' && e.reason !== 'normal'
  ).length;
  
  return totalSessions > 0
    ? Math.max(0, 100 - (failedSessions / totalSessions * 100))
    : 100;
}

function calculateStabilityScore(db) {
  const totalConnections = db.statistics.totalConnections;
  const failedConnections = db.statistics.connectionEvents.filter(
    e => e.type === 'disconnection' && e.reason !== 'normal'
  ).length;
  
  return totalConnections > 0
    ? Math.max(0, 100 - (failedConnections / totalConnections * 100))
    : 100;
}

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Enhanced connection handler
app.post('/api/connect', async (req, res) => {
  const { instanceId, userId, userAgent = 'Unknown', location } = req.body;
  const ip = req.ip;
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  if (!instanceId) {
    await logError('Missing instanceId', ip);
    return res.status(400).json({ error: 'instanceId required' });
  }

  const db = await loadDB();
  const isReconnection = !!db.instances[instanceId];
  const instance = db.instances[instanceId] || {};
  
  // IP History tracking
  const ipHistory = instance.ipHistory || [];
  if (!ipHistory.includes(ip)) {
    ipHistory.push(ip);
  }

  // Session tracking
  const currentSession = {
    start: now,
    end: null,
    duration: null,
    ip,
    userAgent,
    location
  };

  if (!isReconnection) {
    // New connection
    db.instances[instanceId] = {
      firstSeen: now,
      lastActive: now,
      lastReconnect: now,
      status: 'connected',
      userAgent,
      ipAddress: ip,
      ipHistory,
      userId,
      connectionCount: 1,
      disconnectionCount: 0,
      sessions: [currentSession],
      currentSession,
      qualityIssues: [],
      avgSessionDuration: 0,
      healthScore: 100
    };
    db.statistics.totalConnections += 1;
  } else {
    // Reconnection logic
    if (instance.status === 'disconnected') {
      db.statistics.reconnections += 1;
      
      // Calculate previous session duration
      if (instance.currentSession) {
        instance.currentSession.end = now;
        instance.currentSession.duration = now - instance.currentSession.start;
        
        // Update session metrics
        const durations = instance.sessions
          .filter(s => s.duration)
          .map(s => s.duration);
        
        if (durations.length > 0) {
          instance.avgSessionDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        }
      }
    }

    // Update instance data
    instance.lastActive = now;
    instance.lastReconnect = now;
    instance.status = 'connected';
    instance.connectionCount += 1;
    instance.currentSession = currentSession;
    instance.sessions.push(currentSession);
    instance.qualityIssues = detectConnectionQuality(instance, now);
    instance.healthScore = calculateHealthScore(instance);
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
  db.statistics.connectionEvents.push({
    type: 'connection',
    instanceId,
    timestamp: now,
    isReconnection
  });

  // Update connection counts and quality metrics
  updateConnectionStats(db, now);
  updateQualityMetrics(db);

  await saveDB(db);
  res.json({ 
    success: true,
    isReconnection,
    instanceId,
    healthScore: instance.healthScore,
    qualityIssues: instance.qualityIssues
  });
});

// Enhanced disconnection handler
app.post('/api/disconnect', async (req, res) => {
  const { instanceId, reason = 'unknown' } = req.body;
  const now = Date.now();

  if (!instanceId) {
    return res.status(400).json({ error: 'instanceId required' });
  }

  const db = await loadDB();
  
  if (db.instances[instanceId]) {
    const instance = db.instances[instanceId];
    
    // Session tracking
    if (instance.currentSession) {
      instance.currentSession.end = now;
      instance.currentSession.duration = now - instance.currentSession.start;
      instance.currentSession.disconnectReason = reason;
      
      // Update session metrics
      const durations = instance.sessions
        .filter(s => s.duration)
        .map(s => s.duration);
      
      if (durations.length > 0) {
        instance.avgSessionDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      }
    }

    instance.status = 'disconnected';
    instance.lastActive = now;
    instance.disconnectionCount += 1;
    instance.healthScore = calculateHealthScore(instance);
    
    db.statistics.disconnections += 1;
    
    // Record disconnection event
    db.statistics.connectionEvents.push({
      type: 'disconnection',
      instanceId,
      timestamp: now,
      reason,
      duration: instance.currentSession?.duration
    });

    updateConnectionStats(db, now);
    updateQualityMetrics(db);
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

// New health check endpoint
app.get('/api/instance-health/:instanceId', async (req, res) => {
  const db = await loadDB();
  const instance = db.instances[req.params.instanceId];
  
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  res.json({
    instanceId: req.params.instanceId,
    healthScore: instance.healthScore,
    qualityIssues: instance.qualityIssues,
    avgSessionDuration: instance.avgSessionDuration,
    connectionCount: instance.connectionCount,
    lastSession: instance.sessions[instance.sessions.length - 1],
    recommendations: generateRecommendations(instance)
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
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

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});