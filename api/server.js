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

const logError = async (message, ip) => {
    const log = `[${new Date().toISOString()}] [${ip}] ${message}\n`;
    await fs.appendFile(LOG_PATH, log).catch(() => {});
};

const loadDB = async () => {
    try {
        const raw = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        await logError(`DB read error: ${e.message}`, 'SYSTEM');
        return {};
    }
};

const saveDB = async (data) => {
    try {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        await logError(`DB write error: ${e.message}`, 'SYSTEM');
    }
};

// POST: Track user activity
app.post('/api/track', async (req, res) => {
    const ip = req.ip;
    const { userId, timestamp } = req.body;

    if (!userId || !timestamp) {
        await logError('Invalid payload', ip);
        return res.status(400).json({ error: 'Invalid payload' });
    }

    const db = await loadDB();
    db[userId] = timestamp;
    await saveDB(db);
    res.status(200).json({ success: true });
});

// GET: Analytics stats
app.get('/api/stats', async (req, res) => {
    const db = await loadDB();
    const now = Date.now();
    let total = 0, concurrent = 0, disconnected = 0;

    for (const [id, ts] of Object.entries(db)) {
        total++;
        if (now - ts <= TIMEOUTS.concurrent) concurrent++;
        if (now - ts >= TIMEOUTS.disconnected) disconnected++;
    }

    res.json({
        totalUsers: total,
        concurrentUsers: concurrent,
        disconnectedUsers: disconnected,
        lastUpdate: new Date().toISOString(),
        totalRequests: Object.keys(db).length
    });
});

// Start
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});