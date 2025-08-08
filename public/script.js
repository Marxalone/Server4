// Configuration
const CONFIG = {
  refreshInterval: 5000,
  apiBaseUrl: '',
  timeouts: {
    concurrent: 30 * 60 * 1000,
    disconnected: 12 * 60 * 60 * 1000
  }
};

// Chart instances
let charts = {
  activity: null,
  status: null,
  messageType: null,
  health: null,
  error: null
};

// State
let appState = {
  lastUpdate: null,
  startTime: Date.now(),
  previousStats: null,
  chartDataHistory: {
    activity: [],
    errors: []
  }
};

// DOM Elements
const elements = {
  // Stats
  totalInstances: document.getElementById('totalInstances'),
  activeInstances: document.getElementById('activeInstances'),
  totalConnections: document.getElementById('totalConnections'),
  totalUsers: document.getElementById('totalUsers'),
  activeUsers: document.getElementById('activeUsers'),
  totalMessages: document.getElementById('totalMessages'),
  errorRate: document.getElementById('errorRate'),
  avgUptime: document.getElementById('avgUptime'),
  
  // System
  lastUpdate: document.getElementById('lastUpdate'),
  uptime: document.getElementById('uptime'),
  apiStatus: document.getElementById('apiStatus'),
  dataVersion: document.getElementById('dataVersion'),
  connectionStatus: document.getElementById('connectionStatus'),
  errorRateValue: document.getElementById('errorRateValue'),
  activePercent: document.getElementById('activePercent'),
  
  // Tables
  instancesTable: document.querySelector('#instancesTable tbody'),
  errorsTable: document.querySelector('#errorsTable tbody')
};

// Initialize application
async function init() {
  console.log('Initializing MarxBot Analytics Dashboard');
  
  // Initialize charts
  initCharts();
  
  // Load initial data
  await fetchData();
  
  // Start periodic updates
  setInterval(fetchData, CONFIG.refreshInterval);
  setInterval(updateUptime, 1000);
  
  // Handle window resize
  window.addEventListener('resize', handleResize);
}

// Initialize charts
function initCharts() {
  charts.activity = echarts.init(document.getElementById('activityChart'));
  charts.status = echarts.init(document.getElementById('statusChart'));
  charts.messageType = echarts.init(document.getElementById('messageTypeChart'));
  charts.health = echarts.init(document.getElementById('healthChart'));
  charts.error = echarts.init(document.getElementById('errorChart'));
  
  // Set basic options for all charts
  Object.values(charts).forEach(chart => {
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        textStyle: {
          color: '#fff'
        },
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderColor: '#0ff',
        borderWidth: 1
      },
      textStyle: {
        color: '#0ff'
      },
      legend: {
        textStyle: {
          color: '#0ff'
        }
      }
    });
  });
}

// Fetch data from API
// Update the fetchData function to handle errors better
// Replace the fetchData function with this version
async function fetchData() {
  try {
    // Show loading state
    elements.connectionStatus.textContent = 'Loading...';
    elements.connectionStatus.style.color = '#ff0';
    
    const [stats, instances, health] = await Promise.all([
      fetchJson('/api/stats').catch(e => ({ error: 'Stats load failed' })),
      fetchJson('/api/instances').catch(e => ({ error: 'Instances load failed' })),
      fetchJson('/api/connection-health').catch(e => ({ error: 'Health check failed' }))
    ]);

    // Load errors separately to prevent complete failure
    let errors = [];
    try {
      errors = await fetchJson('/api/errors');
    } catch (e) {
      console.warn('Error loading failed:', e);
    }

    // Update connection status
    if (health && health.healthStatus) {
      elements.connectionStatus.textContent = health.healthStatus === 'healthy' 
        ? 'CONNECTED' 
        : 'DEGRADED';
      elements.connectionStatus.style.color = health.healthStatus === 'healthy' 
        ? '#0f0' 
        : '#ff0';
    } else {
      elements.connectionStatus.textContent = 'DISCONNECTED';
      elements.connectionStatus.style.color = '#f00';
    }

    // Process stats if available
    if (stats && !stats.error) {
      updateStats(stats, health);
      updateCharts(stats, health);
      updateInstanceTable(instances);
      updateErrorTable(errors);
    }

  } catch (error) {
    console.error('Fatal fetch error:', error);
    elements.connectionStatus.textContent = 'CONNECTION FAILED';
    elements.connectionStatus.style.color = '#f00';
  }
}

// Add this new function to handle null/undefined values
function safeNumber(value, fallback = 0) {
  return isNaN(value) ? fallback : Number(value);
}




// Update stats display
function updateStats(stats, health) {
const formattedUptime = health?.avgUptime 
    ? formatUptime(health.avgUptime) 
    : 'N/A';

  // Calculate error rate safely
  const errorRate = health?.errorRate 
    ? safeNumber(health.errorRate).toFixed(1)
    : '0.0';
  // Basic stats
  elements.totalInstances.textContent = safeNumber(stats?.totalInstances);
  elements.activeInstances.textContent = safeNumber(stats?.activeInstances);
  elements.totalConnections.textContent = safeNumber(stats?.statistics?.totalConnections);
  elements.totalUsers.textContent = safeNumber(stats?.totalUsers);
  elements.activeUsers.textContent = safeNumber(stats?.activeUsers);
  elements.totalMessages.textContent = safeNumber(stats?.statistics?.totalMessages);
  elements.errorRate.textContent = errorRate;
  elements.errorRateValue.textContent = errorRate;
  elements.avgUptime.textContent = formattedUptime;
  elements.dataVersion.textContent = stats?.settings?.version || '2.0.0';
  elements.lastUpdate.textContent = new Date().toLocaleTimeString();
  
  // Calculate trends if we have previous data
  if (appState.previousStats) {
    updateTrend('instance', stats.totalInstances, appState.previousStats.totalInstances);
    updateTrend('active', stats.activeInstances, appState.previousStats.activeInstances);
    updateTrend('connection', stats.statistics.totalConnections, appState.previousStats.statistics.totalConnections);
    updateTrend('user', stats.totalUsers, appState.previousStats.totalUsers);
    updateTrend('activeUser', stats.activeUsers, appState.previousStats.activeUsers);
    updateTrend('message', stats.statistics.totalMessages, appState.previousStats.statistics.totalMessages);
    updateTrend('error', health.errorRate, appState.previousStats.errorRate);
    updateTrend('uptime', health.avgUptime, appState.previousStats.avgUptime);
  }
  
  appState.previousStats = {...stats, ...health};
}

function calculateActivePercent(stats) {
  if (stats.totalInstances === 0) return 0;
  return ((stats.activeInstances / stats.totalInstances) * 100).toFixed(1);
}

function formatUptime(ms) {
  if (!ms) return '0s';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return `${days > 0 ? days + 'd ' : ''}${hours > 0 ? hours + 'h ' : ''}${mins}m ${secs}s`;
}

// Update trend indicators
function updateTrend(type, current, previous) {
  const element = document.getElementById(`${type}Trend`);
  if (!element) return;
  
  const diff = current - previous;
  if (diff > 0) {
    element.textContent = `↑ ${diff}`;
    element.style.color = '#0f0';
  } else if (diff < 0) {
    element.textContent = `↓ ${Math.abs(diff)}`;
    element.style.color = '#f00';
  } else {
    element.textContent = '→ 0';
    element.style.color = '#ccc';
  }
}

// Update charts
function updateCharts(stats, health) {
  // Activity chart (line)
  charts.activity.setOption({
    xAxis: {
      type: 'category',
      data: Object.keys(stats.statistics.dailyActive),
      axisLabel: { color: '#0ff' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#0ff' }
    },
    series: [{
      data: Object.values(stats.statistics.dailyActive),
      type: 'line',
      smooth: true,
      lineStyle: { color: '#0ff', width: 3 },
      areaStyle: { color: 'rgba(0, 255, 255, 0.3)' },
      symbol: 'circle',
      symbolSize: 8,
      itemStyle: {
        color: '#0ff'
      }
    }]
  });
  
  // Status chart (pie)
  charts.status.setOption({
    series: [{
      type: 'pie',
      radius: ['50%', '70%'],
      data: [
        { value: stats.activeInstances, name: 'Active', itemStyle: { color: '#0f0' }},
        { value: stats.inactiveInstances, name: 'Inactive', itemStyle: { color: '#f00' }}
      ],
      label: { 
        color: '#fff',
        formatter: '{b}: {c} ({d}%)'
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  });
  
  // Message type chart (bar)
  const messageTypes = stats.statistics.messageTypes || {};
  charts.messageType.setOption({
    xAxis: {
      type: 'category',
      data: Object.keys(messageTypes),
      axisLabel: { 
        color: '#0ff',
        rotate: 30
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#0ff' }
    },
    series: [{
      data: Object.values(messageTypes),
      type: 'bar',
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#0ff' },
          { offset: 1, color: '#00f' }
        ])
      }
    }]
  });
  
  // Health chart (gauge)
  charts.health.setOption({
    series: [{
      type: 'gauge',
      center: ['50%', '60%'],
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 100,
      splitNumber: 10,
      radius: '100%',
      axisLine: {
        lineStyle: {
          width: 30,
          color: [
            [0.3, '#f00'],
            [0.7, '#ff0'],
            [1, '#0f0']
          ]
        }
      },
      pointer: {
        itemStyle: {
          color: '#0ff'
        },
        length: '60%',
        width: 8
      },
      axisTick: {
        distance: -30,
        length: 8,
        lineStyle: {
          color: '#fff',
          width: 2
        }
      },
      splitLine: {
        distance: -30,
        length: 30,
        lineStyle: {
          color: '#fff',
          width: 4
        }
      },
      axisLabel: {
        color: '#fff',
        distance: 25,
        fontSize: 14
      },
      detail: {
        valueAnimation: true,
        formatter: '{value}%',
        color: '#0ff',
        fontSize: 20
      },
      data: [{
        value: calculateActivePercent(stats)
      }]
    }]
  });
  
  // Error chart (line)
  charts.error.setOption({
    xAxis: {
      type: 'category',
      data: Object.keys(stats.statistics.errors || {}),
      axisLabel: { color: '#0ff' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#0ff' }
    },
    series: [{
      data: Object.values(stats.statistics.errors || {}),
      type: 'line',
      smooth: true,
      lineStyle: { color: '#f00', width: 3 },
      areaStyle: { color: 'rgba(255, 0, 0, 0.3)' },
      symbol: 'diamond',
      symbolSize: 10,
      itemStyle: {
        color: '#f00'
      }
    }]
  });
}

function updateChartDataHistory(stats, health) {
  // Keep last 30 data points for each chart
  if (appState.chartDataHistory.activity.length >= 30) {
    appState.chartDataHistory.activity.shift();
    appState.chartDataHistory.errors.shift();
  }
  
  appState.chartDataHistory.activity.push({
    date: new Date().toLocaleTimeString(),
    value: stats.activeInstances
  });
  
  appState.chartDataHistory.errors.push({
    date: new Date().toLocaleTimeString(),
    value: Object.values(stats.statistics.errors || {}).reduce((a, b) => a + b, 0)
  });
}

// Update instance table
// Update the instance table to show better status info
function updateInstanceTable(instances) {
  const tbody = elements.instancesTable;
  tbody.innerHTML = '';
  
  const now = Date.now();
  const sortedInstances = instances.instances
    .sort((a, b) => b.lastActive - a.lastActive);
  
  sortedInstances.forEach(instance => {
    const row = document.createElement('tr');
    
    // Status indicator
    let status = '🔴 Disconnected';
    let statusClass = 'error';
    
    if (instance.status === 'connected') {
      if ((now - instance.lastActive) < CONFIG.timeouts.concurrent) {
        status = '🟢 Active';
        statusClass = 'success';
      } else {
        status = '🟡 Idle';
        statusClass = 'warning';
      }
    }
    
    // Last active time
    const lastActive = new Date(instance.lastActive);
    const lastActiveStr = lastActive.toLocaleTimeString();
    
    // Uptime
    const uptime = formatUptime(now - instance.firstSeen);
    
    // User agent (shortened)
    const userAgent = instance.userAgent?.length > 20 ? 
      instance.userAgent.substring(0, 17) + '...' : 
      instance.userAgent || 'Unknown';
    
    row.innerHTML = `
      <td>${instance.id.substring(0, 8)}...</td>
      <td>${userAgent}</td>
      <td>${lastActiveStr}</td>
      <td>${uptime}</td>
      <td class="${statusClass}">${status}</td>
    `;
    
    tbody.appendChild(row);
  });
}
// Update error table
function updateErrorTable(errors) {
  const tbody = elements.errorsTable;
  tbody.innerHTML = '';
  
  const recentErrors = errors.slice(0, 10); // Show last 10 errors
  
  recentErrors.forEach(error => {
    const row = document.createElement('tr');
    const time = new Date(error.timestamp).toLocaleTimeString();
    
    row.innerHTML = `
      <td>${error.instanceId?.substring(0, 8) || 'System'}</td>
      <td>${error.errorType}</td>
      <td>${error.error.substring(0, 50)}${error.error.length > 50 ? '...' : ''}</td>
      <td>${time}</td>
    `;
    
    tbody.appendChild(row);
  });
}

// Update uptime display
function updateUptime() {
  const seconds = Math.floor((Date.now() - appState.startTime) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  elements.uptime.textContent = `${days}d ${hours}h ${mins}m ${secs}s`;
}

// Handle window resize
function handleResize() {
  Object.values(charts).forEach(chart => chart.resize());
}

// Helper function to fetch JSON
async function fetchJson(endpoint) {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);