const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const app = express();
const { PORT, TIMEOUTS, LOGGING } = require('../config');

const DB_PATH = path.join(__dirname, '../db/db.json');
const LOG_PATH = path.join(__dirname, '../logs/errors.log');

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Enhanced data structure
const initialDB = {
    instances: {},    // Track bot instances { instanceId: { lastActive, firstSeen, status } }
    users: {},        // Track user activity per instance
    statistics: {
        totalConnections: 0,
        currentConnections: 0,
        peakConnections: 0,
        disconnections: 0
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
        const raw = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        // Initialize with proper structure if DB doesn't exist
        await saveDB(initialDB);
        return initialDB;
    }
};

const saveDB = async (data) => {
    try {
        await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        await logError(`DB write error: ${e.message}`, 'SYSTEM');
    }
};

// Connection tracking endpoint
app.post('/api/connect', async (req, res) => {
    const { instanceId, userId, userAgent } = req.body;
    const ip = req.ip;
    const now = Date.now();

    if (!instanceId) {
        await logError('Invalid payload - missing instanceId', ip);
        return res.status(400).json({ error: 'instanceId required' });
    }

    const db = await loadDB();
    
    // Initialize or update instance
    if (!db.instances[instanceId]) {
        db.instances[instanceId] = {
            firstSeen: now,
            lastActive: now,
            status: 'connected',
            userAgent: userAgent,
            ipAddress: ip
        };
        db.statistics.totalConnections += 1;
    } else {
        db.instances[instanceId].lastActive = now;
        db.instances[instanceId].status = 'connected';
    }
    
    // Update current connections count
    db.statistics.currentConnections = Object.values(db.instances)
        .filter(i => i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent)
        .length;
        
    // Update peak connections
    if (db.statistics.currentConnections > db.statistics.peakConnections) {
        db.statistics.peakConnections = db.statistics.currentConnections;
    }

    await saveDB(db);
    res.status(200).json({ success: true });
});

// Disconnection tracking endpoint
app.post('/api/disconnect', async (req, res) => {
    const { instanceId } = req.body;
    const ip = req.ip;
    const now = Date.now();

    if (!instanceId) {
        await logError('Invalid payload - missing instanceId', ip);
        return res.status(400).json({ error: 'instanceId required' });
    }

    const db = await loadDB();
    
    if (db.instances[instanceId]) {
        db.instances[instanceId].status = 'disconnected';
        db.instances[instanceId].lastActive = now;
        db.statistics.disconnections += 1;
        
        // Update current connections count
        db.statistics.currentConnections = Object.values(db.instances)
            .filter(i => i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent)
            .length;
            
        await saveDB(db);
    }

    res.status(200).json({ success: true });
});

// User activity tracking
app.post('/api/track', async (req, res) => {
    const { instanceId, userId } = req.body;
    const ip = req.ip;
    const now = Date.now();

    if (!instanceId || !userId) {
        await logError('Invalid payload - missing instanceId or userId', ip);
        return res.status(400).json({ error: 'instanceId and userId required' });
    }

    const db = await loadDB();
    
    // Initialize user if not exists
    if (!db.users[userId]) {
        db.users[userId] = {
            firstSeen: now,
            lastActive: now,
            instances: [instanceId]
        };
    } else {
        // Update existing user
        db.users[userId].lastActive = now;
        if (!db.users[userId].instances.includes(instanceId)) {
            db.users[userId].instances.push(instanceId);
        }
    }
    
    // Update instance activity
    if (db.instances[instanceId]) {
        db.instances[instanceId].lastActive = now;
    }

    await saveDB(db);
    res.status(200).json({ success: true });
});

// Get stats
app.get('/api/stats', async (req, res) => {
    const db = await loadDB();
    const now = Date.now();
    
    // Calculate active instances (connected and recently active)
    const activeInstances = Object.values(db.instances)
        .filter(i => i.status === 'connected' && (now - i.lastActive) < TIMEOUTS.concurrent);
        
    // Calculate inactive instances (disconnected or timed out)
    const inactiveInstances = Object.values(db.instances)
        .filter(i => i.status !== 'connected' || (now - i.lastActive) >= TIMEOUTS.concurrent);

    res.json({
        totalInstances: Object.keys(db.instances).length,
        activeInstances: activeInstances.length,
        inactiveInstances: inactiveInstances.length,
        totalUsers: Object.keys(db.users).length,
        activeUsers: Object.values(db.users)
            .filter(u => (now - u.lastActive) < TIMEOUTS.concurrent)
            .length,
        statistics: db.statistics,
        lastUpdate: new Date().toISOString()
    });
});

// Get instance details
app.get('/api/instances', async (req, res) => {
    const db = await loadDB();
    res.json(db.instances);
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});