// Updated server.js with improved user tracking
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
    users: {},       // { userId: { lastActive, firstSeen, activeCount } }
    statistics: {
        totalMessages: 0,
        peakConcurrency: 0,
        dailyActive: {}
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
// Add this near the top with other constants
const USER_AGENTS = {
    'Baileys': /Baileys/i,
    'WhatsApp-Bot': /WhatsApp-Bot/i,
    'Custom-Bot': /Custom-Bot/i
    // Add more patterns as needed
};

// Modify the track endpoint to capture user agent
app.post('/api/track', async (req, res) => {
    const ip = req.ip;
    const { userId, timestamp = Date.now(), eventType = 'activity' } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';

    if (!userId) {
        await logError('Invalid payload - missing userId', ip);
        return res.status(400).json({ error: 'userId required' });
    }

    const db = await loadDB();
    const now = timestamp;
    const today = new Date(now).toISOString().split('T')[0];

    // Detect bot type from user agent
    let botType = 'Unknown';
    for (const [type, regex] of Object.entries(USER_AGENTS)) {
        if (regex.test(userAgent)) {
            botType = type;
            break;
        }
    }

    // Initialize user if not exists
    if (!db.users[userId]) {
        db.users[userId] = {
            firstSeen: now,
            lastActive: now,
            activeCount: 1,
            sessions: [],
            botType: botType,
            userAgent: userAgent
        };
    } else {
        // Update existing user
        const user = db.users[userId];
        user.lastActive = now;
        user.activeCount = (user.activeCount || 0) + 1;
        
        // Update bot type if not set or changed
        if (!user.botType || user.botType === 'Unknown') {
            user.botType = botType;
        }
    }

    // Track user agents
    db.statistics.userAgents = db.statistics.userAgents || {};
    db.statistics.userAgents[botType] = (db.statistics.userAgents[botType] || 0) + 1;

    // Update statistics
    db.statistics.totalMessages += 1;
    db.statistics.dailyActive[today] = (db.statistics.dailyActive[today] || 0) + 1;

    await saveDB(db);
    res.status(200).json({ success: true });
});

// Add new endpoint for bot instance stats
app.get('/api/bot-stats', async (req, res) => {
    const db = await loadDB();
    
    // Count users by bot type
    const botTypeCounts = {};
    Object.values(db.users).forEach(user => {
        const type = user.botType || 'Unknown';
        botTypeCounts[type] = (botTypeCounts[type] || 0) + 1;
    });

    res.json({
        botTypes: botTypeCounts,
        userAgents: db.statistics.userAgents || {}
    });
});

// Enhanced tracking endpoint
app.post('/api/track', async (req, res) => {
    const ip = req.ip;
    const { userId, timestamp = Date.now(), eventType = 'activity' } = req.body;

    if (!userId) {
        await logError('Invalid payload - missing userId', ip);
        return res.status(400).json({ error: 'userId required' });
    }

    const db = await loadDB();
    const now = timestamp;
    const today = new Date(now).toISOString().split('T')[0];

    // Initialize user if not exists
    if (!db.users[userId]) {
        db.users[userId] = {
            firstSeen: now,
            lastActive: now,
            activeCount: 1,
            sessions: []
        };
    } else {
        // Update existing user
        const user = db.users[userId];
        user.lastActive = now;
        user.activeCount = (user.activeCount || 0) + 1;
    }

    // Update statistics
    db.statistics.totalMessages += 1;
    
    // Update daily active
    db.statistics.dailyActive[today] = (db.statistics.dailyActive[today] || 0) + 1;

    await saveDB(db);
    res.status(200).json({ success: true });
});

// Enhanced stats endpoint
app.get('/api/stats', async (req, res) => {
    const db = await loadDB();
    const now = Date.now();
    
    let total = 0, concurrent = 0, disconnected = 0;
    const activeUsers = new Set();
    const dailyActive = Object.values(db.statistics.dailyActive).reduce((a, b) => a + b, 0);

    for (const [userId, userData] of Object.entries(db.users)) {
        total++;
        if (now - userData.lastActive <= TIMEOUTS.concurrent) {
            concurrent++;
            activeUsers.add(userId);
        }
        if (now - userData.lastActive >= TIMEOUTS.disconnected) {
            disconnected++;
        }
    }

    // Update peak concurrency
    if (concurrent > db.statistics.peakConcurrency) {
        db.statistics.peakConcurrency = concurrent;
        await saveDB(db);
    }

    res.json({
        totalUsers: total,
        concurrentUsers: concurrent,
        disconnectedUsers: disconnected,
        activeUsers: Array.from(activeUsers),
        dailyActiveUsers: dailyActive,
        peakConcurrency: db.statistics.peakConcurrency,
        totalMessages: db.statistics.totalMessages,
        lastUpdate: new Date().toISOString()
    });
});

// New endpoint for historical data
app.get('/api/history', async (req, res) => {
    const db = await loadDB();
    res.json({
        dailyActive: db.statistics.dailyActive,
        userGrowth: Object.keys(db.users).length,
        messageHistory: db.statistics.totalMessages
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});