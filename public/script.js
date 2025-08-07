// Configuration
const CONFIG = {
  refreshInterval: 5000,
  apiBaseUrl: '',
  timeouts: {
    concurrent: 30 * 60 * 1000, // 30 minutes
    disconnected: 12 * 60 * 60 * 1000 // 12 hours
  }
};

// Chart instances
let charts = {
  activity: null,
  status: null,
  message: null
};

// State
let appState = {
  lastUpdate: null,
  startTime: Date.now(),
  previousStats: null
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
  
  // System
  lastUpdate: document.getElementById('lastUpdate'),
  uptime: document.getElementById('uptime'),
  apiStatus: document.getElementById('apiStatus'),
  dataVersion: document.getElementById('dataVersion'),
  connectionStatus: document.getElementById('connectionStatus'),
  
  // Tables
  instancesTable: document.querySelector('#instancesTable tbody')
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
  charts.message = echarts.init(document.getElementById('messageChart'));
  
  // Set basic options for all charts
  Object.values(charts).forEach(chart => {
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item'
      },
      textStyle: {
        color: '#0ff'
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
    
    const [stats, instances] = await Promise.all([
      fetchJson('/api/stats'),
      fetchJson('/api/instances')
    ]);
    
    const fetchDuration = (performance.now() - startTime).toFixed(2);
    elements.apiStatus.textContent = `OK (${fetchDuration}ms)`;
    elements.connectionStatus.textContent = 'Connected';
    elements.connectionStatus.style.color = '#0f0';
    
    // Update last update time
    appState.lastUpdate = new Date(stats.lastUpdate);
    elements.lastUpdate.textContent = appState.lastUpdate.toLocaleTimeString();
    
    // Update stats
    updateStats(stats, instances);
    
    // Update charts
    updateCharts(stats, instances);
    
    // Update instance table
    updateInstanceTable(instances);
    
  } catch (error) {
    console.error('Failed to fetch data:', error);
    elements.apiStatus.textContent = 'Error';
    elements.apiStatus.style.color = '#f00';
    elements.connectionStatus.textContent = 'Connection failed';
    elements.connectionStatus.style.color = '#f00';
  }
}

// Update stats display
function updateStats(stats, instances) {
  // Basic stats
  elements.totalInstances.textContent = stats.totalInstances;
  elements.activeInstances.textContent = stats.activeInstances;
  elements.totalConnections.textContent = stats.statistics.totalConnections;
  elements.totalUsers.textContent = stats.totalUsers;
  elements.activeUsers.textContent = stats.activeUsers;
  elements.totalMessages.textContent = stats.statistics.totalMessages;
  elements.dataVersion.textContent = stats.statistics.version || '1.0.0';
  
  // Calculate trends if we have previous data
  if (appState.previousStats) {
    updateTrend('instance', stats.totalInstances, appState.previousStats.totalInstances);
    updateTrend('active', stats.activeInstances, appState.previousStats.activeInstances);
    updateTrend('connection', stats.statistics.totalConnections, appState.previousStats.statistics.totalConnections);
    updateTrend('user', stats.totalUsers, appState.previousStats.totalUsers);
    updateTrend('activeUser', stats.activeUsers, appState.previousStats.activeUsers);
    updateTrend('message', stats.statistics.totalMessages, appState.previousStats.statistics.totalMessages);
  }
  
  appState.previousStats = stats;
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
function updateCharts(stats, instances) {
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
      lineStyle: { color: '#0ff' },
      areaStyle: { color: 'rgba(0, 255, 255, 0.3)' }
    }]
  });
  
  // Status chart (pie)
  charts.status.setOption({
    series: [{
      type: 'pie',
      radius: '70%',
      data: [
        { value: stats.activeInstances, name: 'Active', itemStyle: { color: '#0f0' }},
        { value: stats.inactiveInstances, name: 'Inactive', itemStyle: { color: '#f00' }}
      ],
      label: { color: '#fff' }
    }]
  });
  
  // Message chart (bar)
  charts.message.setOption({
    xAxis: {
      type: 'category',
      data: ['Messages']
    },
    yAxis: {
      type: 'value'
    },
    series: [{
      data: [stats.statistics.totalMessages],
      type: 'bar',
      itemStyle: { color: '#0ff' }
    }]
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
    
    // User agent (shortened)
    const userAgent = instance.userAgent.length > 20 ? 
      instance.userAgent.substring(0, 17) + '...' : 
      instance.userAgent;
    
    row.innerHTML = `
      <td>${id.substring(0, 8)}...</td>
      <td>${userAgent}</td>
      <td>${lastActiveStr}</td>
      <td>${status}</td>
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