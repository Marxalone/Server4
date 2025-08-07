module.exports = {
    PORT: process.env.PORT || 3000,
    TIMEOUTS: {
        concurrent: 30 * 60 * 1000, // 30 mins
        disconnected: 12 * 60 * 60 * 1000 // 12 hrs
    },
    LOGGING: {
        enable: true
    }
};