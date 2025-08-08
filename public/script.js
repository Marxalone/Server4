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
async function fetchData() {
  try {
    const startTime = performance.now();
    elements.apiStatus.textContent = 'Fetching...';
    elements.connectionStatus.textContent = 'Updating data...';
    
    const [stats, instances, health, errors] = await Promise.all([
      fetchJson('/api/stats'),
      fetchJson('/api/instances'),
      fetchJson('/api/connection-health'),
      fetchJson('/api/errors')
    ]);
    
    const fetchDuration = (performance.now() - startTime).toFixed(2);
    elements.apiStatus.textContent = `OK (${fetchDuration}ms)`;
    elements.connectionStatus.textContent = 'Connected';
    elements.connectionStatus.style.color = '#0f0';
    
    // Update last update time
    appState.lastUpdate = new Date(stats.lastUpdate);
    elements.lastUpdate.textContent = appState.lastUpdate.toLocaleTimeString();
    
    // Update stats
    updateStats(stats, health);
    
    // Update charts
    updateCharts(stats, health);
    
    // Update tables
    updateInstanceTable(instances);
    updateErrorTable(errors);
    
    // Store historical data for trends
    updateChartDataHistory(stats, health);
    
  } catch (error) {
    console.error('Failed to fetch data:', error);
    elements.apiStatus.textContent = 'Error';
    elements.apiStatus.style.color = '#f00';
    elements.connectionStatus.textContent = 'Connection failed';
    elements.connectionStatus.style.color = '#f00';
  }
}

// Update stats display
function updateStats(stats, health) {
  // Basic stats
  elements.totalInstances.textContent = stats.totalInstances;
  elements.activeInstances.textContent = stats.activeInstances;
  elements.totalConnections.textContent = stats.statistics.totalConnections;
  elements.totalUsers.textContent = stats.totalUsers;
  elements.activeUsers.textContent = stats.activeUsers;
  elements.totalMessages.textContent = stats.statistics.totalMessages;
  elements.dataVersion.textContent = stats.settings.version || '2.0.0';
  
  // New stats
  elements.errorRate.textContent = health.errorRate || 0;
  elements.errorRateValue.textContent = health.errorRate || 0;
  elements.avgUptime.textContent = formatUptime(health.avgUptime);
  elements.activePercent.textContent = calculateActivePercent(stats);
  
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
function updateInstanceTable(instances) {
  const tbody = elements.instancesTable;
  tbody.innerHTML = '';
  
  const now = Date.now();
  const sortedInstances = Object.entries(instances.instances)
    .sort((a, b) => b[1].lastActive - a[1].lastActive);
  
  sortedInstances.forEach(([id, instance]) => {
    const row = document.createElement('tr');
    
    // Status indicator
    const status = instance.status === 'connected' && 
      (now - instance.lastActive) < CONFIG.timeouts.concurrent ?
      '🟢' : '🔴';
    
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
      <td>${id.substring(0, 8)}...</td>
      <td>${userAgent}</td>
      <td>${lastActiveStr}</td>
      <td>${uptime}</td>
      <td>${status}</td>
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