// Initialize charts
let activityChart, statusChart, messageChart, botChart;
let lastData = null;
let startTime = Date.now();

// DOM elements
const elements = {
    total: document.querySelector('#total .stat-value span'),
    concurrent: document.querySelector('#concurrent .stat-value span'),
    disconnected: document.querySelector('#disconnected .stat-value span'),
    peak: document.querySelector('#peak .stat-value span'),
    activeUsers: document.getElementById('activeUsers'),
    lastUpdate: document.getElementById('lastUpdate'),
    uptime: document.getElementById('uptime')
};

// Format numbers with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Helper function for random neon colors
function getRandomNeonColor() {
    const colors = [
        '#0ff', '#f0f', '#0f0', '#ff0', '#f80',
        '#8f0', '#0f8', '#08f', '#80f', '#f08'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Update uptime counter
function updateUptime() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    elements.uptime.textContent = 
        `${days}d ${hours}h ${mins}m ${secs}s`;
}

// Initialize charts
function initCharts() {
    // Activity Chart (Line chart)
    activityChart = echarts.init(document.getElementById('activityChart'));
    
    // Status Chart (Doughnut)
    statusChart = echarts.init(document.getElementById('statusChart'));
    
    // Message Chart (Bar)
    messageChart = echarts.init(document.getElementById('messageChart'));
    
    // Bot Chart (Pie)
    botChart = echarts.init(document.getElementById('botChart'));
    
    // Set initial options
    updateCharts({
        totalUsers: 0,
        concurrentUsers: 0,
        disconnectedUsers: 0,
        peakConcurrency: 0,
        totalMessages: 0,
        dailyActive: {},
        botTypes: {}
    });
}

// Update charts with new data
function updateCharts(data) {
    // Activity Chart (Line)
    const activityOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis'
        },
        xAxis: {
            type: 'category',
            data: Object.keys(data.dailyActive || {}),
            axisLine: { lineStyle: { color: '#0ff' }},
            axisLabel: { color: '#aaa' }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#0ff' }},
            axisLabel: { color: '#aaa' },
            splitLine: { lineStyle: { color: 'rgba(0, 255, 255, 0.1)' }}
        },
        series: [{
            data: Object.values(data.dailyActive || {}),
            type: 'line',
            smooth: true,
            lineStyle: {
                width: 3,
                color: '#0ff'
            },
            itemStyle: {
                color: '#0ff',
                borderWidth: 2
            },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(0, 255, 255, 0.5)' },
                    { offset: 1, color: 'rgba(0, 255, 255, 0.1)' }
                ])
            }
        }]
    };
    activityChart.setOption(activityOption);
    
    // Status Chart (Doughnut)
    const statusOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item'
        },
        legend: {
            data: ['Active', 'Inactive', 'Others'],
            textStyle: { color: '#aaa' },
            bottom: 0
        },
        series: [{
            name: 'User Status',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: {
                borderRadius: 10,
                borderColor: '#000',
                borderWidth: 2
            },
            label: {
                show: false,
                position: 'center'
            },
            emphasis: {
                label: {
                    show: true,
                    fontSize: '18',
                    fontWeight: 'bold',
                    color: '#0ff'
                }
            },
            labelLine: {
                show: false
            },
            data: [
                { value: data.concurrentUsers, name: 'Active', itemStyle: { color: '#0ff' }},
                { value: data.disconnectedUsers, name: 'Inactive', itemStyle: { color: '#f0f' }},
                { 
                    value: data.totalUsers - data.concurrentUsers - data.disconnectedUsers, 
                    name: 'Others', 
                    itemStyle: { color: '#08f' }
                }
            ]
        }]
    };
    statusChart.setOption(statusOption);
    
    // Message Chart (Bar)
    const messageOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow'
            }
        },
        xAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#0ff' }},
            axisLabel: { color: '#aaa' },
            splitLine: { lineStyle: { color: 'rgba(0, 255, 255, 0.1)' }}
        },
        yAxis: {
            type: 'category',
            data: ['Total Messages'],
            axisLine: { lineStyle: { color: '#0ff' }},
            axisLabel: { color: '#aaa' }
        },
        series: [{
            name: 'Messages',
            type: 'bar',
            data: [data.totalMessages],
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: '#0ff' },
                    { offset: 1, color: '#f0f' }
                ]),
                borderRadius: [0, 5, 5, 0]
            },
            label: {
                show: true,
                position: 'right',
                color: '#0ff',
                formatter: formatNumber
            }
        }]
    };
    messageChart.setOption(messageOption);
    
    // Bot Chart (Pie)
    const botOption = {
        backgroundColor: 'transparent',
        title: {
            text: 'Bot Distribution',
            left: 'center',
            textStyle: { color: '#0ff' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{a} <br/>{b}: {c} ({d}%)'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            data: Object.keys(data.botTypes || {}),
            textStyle: { color: '#aaa' }
        },
        series: [
            {
                name: 'Bot Types',
                type: 'pie',
                radius: '50%',
                center: ['50%', '60%'],
                data: Object.entries(data.botTypes || {}).map(([name, value]) => ({
                    value,
                    name,
                    itemStyle: {
                        color: getRandomNeonColor()
                    }
                })),
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                },
                label: {
                    color: '#fff',
                    formatter: '{b}: {c} ({d}%)'
                }
            }
        ]
    };
    botChart.setOption(botOption);
}

// Fetch stats from server
async function fetchStats() {
    try {
        const [statsRes, historyRes, botRes] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/history'),
            fetch('/api/bot-stats')
        ]);
        
        const statsData = await statsRes.json();
        const historyData = await historyRes.json();
        const botData = await botRes.json();
        
        // Update DOM elements
        elements.total.textContent = formatNumber(statsData.totalUsers);
        elements.concurrent.textContent = formatNumber(statsData.concurrentUsers);
        elements.disconnected.textContent = formatNumber(statsData.disconnectedUsers);
        elements.peak.textContent = formatNumber(statsData.peakConcurrency);
        elements.activeUsers.textContent = statsData.activeUsers.length;
        elements.lastUpdate.textContent = new Date(statsData.lastUpdate).toLocaleTimeString();
        
        // Combine data for charts
        const chartData = {
            ...statsData,
            ...botData,
            dailyActive: historyData.dailyActive
        };
        
        // Update charts
        updateCharts(chartData);
        
        // Add pulse animation to updated cards
        document.querySelectorAll('.stat-card').forEach(card => {
            card.classList.remove('pulse');
            setTimeout(() => card.classList.add('pulse'), 10);
        });
        
        lastData = statsData;
    } catch (err) {
        console.error('API Error:', err);
        document.querySelectorAll('.stat-value span').forEach(el => {
            el.textContent = 'ERR';
        });
        elements.lastUpdate.textContent = '⚠️ Connection Error';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    fetchStats();
    
    // Update stats every 5 seconds
    setInterval(fetchStats, 5000);
    
    // Update uptime every second
    setInterval(updateUptime, 1000);
});

// Handle window resize
window.addEventListener('resize', () => {
    activityChart.resize();
    statusChart.resize();
    messageChart.resize();
    botChart.resize();
});