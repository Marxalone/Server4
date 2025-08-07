// Updated script.js with all new features

// Configuration
const CONFIG = {
  refreshInterval: 5000,
  apiBaseUrl: '',
  timeouts: {
    concurrent: 30 * 60 * 1000,
    disconnected: 12 * 60 * 60 * 1000
  },
  healthThresholds: {
    excellent: 90,
    good: 70,
    warning: 50,
    critical: 30
  }
};

// Chart instances
let charts = {
  activity: null,
  status: null,
  message: null,
  duration: null,
  quality: null,
  sessionHistory: null
};

// State
let appState = {
  lastUpdate: null,
  startTime: Date.now(),
  previousStats: null,
  activeAlerts: [],
  instanceCache: {}
};

// DOM Elements
const elements = {
  // Stats
  totalInstances: document.getElementById('totalInstances'),
  activeInstances: document.getElementById('activeInstances'),
  totalConnections: document.getElementById('totalConnections'),
  totalReconnections: document.getElementById('totalReconnections'),
  totalUsers: document.getElementById('totalUsers'),
  activeUsers: document.getElementById('activeUsers'),
  totalMessages: document.getElementById('totalMessages'),
  failedConnections: document.getElementById('failedConnections'),
  avgSessionDuration: document.getElementById('avgSessionDuration'),
  healthScore: document.getElementById('healthScore'),
  healthBar: document.getElementById('healthBar'),
  healthStatus: document.getElementById('healthStatus'),
  stabilityScore: document.getElementById('stabilityScore'),
  
  // System
  lastUpdate: document.getElementById('lastUpdate'),
  uptime: document.getElementById('uptime'),
  apiStatus: document.getElementById('apiStatus'),
  connectionStatus: document.getElementById('connectionStatus'),
  
  // Alerts
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage'),
  issuesList: document.getElementById('issuesList'),
  
  // Tables
  instancesTable: document.querySelector('#instancesTable tbody'),
  
  // Modal
  modal: document.getElementById('instanceModal'),
  closeBtn: document.querySelector('.close-btn'),
  modalInstanceId: document.getElementById('modalInstanceId'),
  modalConnectionCount: document.getElementById('modalConnectionCount'),
  modalAvgSession: document.getElementById('modalAvgSession'),
  modalLastIp: document.getElementById('modalLastIp'),
  instanceRecommendations: document.getElementById('instanceRecommendations')
};

// Initialize application
async function init() {
  console.log('Initializing MarxBot Analytics Dashboard');
  
  // Initialize charts
  initCharts();
  
  // Set up modal
  setupModal();
  
  // Load initial data
  await fetchData();
  
  // Start periodic updates
  setInterval(fetchData, CONFIG.refreshInterval);
  setInterval(updateUptime, 1000);
  
  // Handle window resize
  window.addEventListener('resize', handleResize);
}

function setupModal() {
  elements.closeBtn.addEventListener('click', () => {
    elements.modal.style.display = 'none';
  });
  
  window.addEventListener('click', (e) => {
    if (e.target === elements.modal) {
      elements.modal.style.display = 'none';
    }
  });
}

function showInstanceDetails(instanceId) {
  const instance = appState.instanceCache[instanceId];
  if (!instance) return;
  
  elements.modalInstanceId.textContent = `Instance: ${instanceId.substring(0, 12)}...`;
  elements.modalConnectionCount.textContent = instance.connectionCount;
  elements.modalAvgSession.textContent = `${Math.round(instance.avgSessionDuration / 1000)}s`;
  elements.modalLastIp.textContent = instance.ipAddress;
  
  // Update health gauge
  updateHealthGauge(instance.healthScore);
  
  // Update recommendations
  elements.instanceRecommendations.innerHTML = '';
  if (instance.recommendations && instance.recommendations.length > 0) {
    instance.recommendations.forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      elements.instanceRecommendations.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No recommendations needed';
    elements.instanceRecommendations.appendChild(li);
  }
  
  // Update session history chart
  updateSessionHistoryChart(instance);
  
  elements.modal.style.display = 'block';
}

function updateHealthGauge(score) {
  const gaugeOption = {
    series: [{
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: getHealthColor(score)
        }
      },
      axisLine: {
        lineStyle: { width: 15 }
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 20,
        color: '#fff',
        formatter: '{value}',
        offsetCenter: ['0%', '0%']
      },
      data: [{
        value: score,
        name: 'Health'
      }]
    }]
  };
  
  if (!charts.sessionHistory) {
    charts.sessionHistory = echarts.init(document.getElementById('instanceHealthGauge'));
  }
  charts.sessionHistory.setOption(gaugeOption);
}

function updateSessionHistoryChart(instance) {
  if (!instance.sessions) return;
  
  const durations = instance.sessions
    .filter(s => s.duration)
    .map(s => Math.round(s.duration / 1000));
  
  const timestamps = instance.sessions
    .filter(s => s.duration)
    .map(s => new Date(s.start).toLocaleTimeString());
  
  const option = {
    xAxis: {
      type: 'category',
      data: timestamps,
      axisLabel: { color: '#0ff', rotate: 45 }
    },
    yAxis: {
      type: 'value',
      name: 'Duration (s)',
      axisLabel: { color: '#0ff' }
    },
    series: [{
      data: durations,
      type: 'bar',
      itemStyle: {
        color: function(params) {
          const duration = durations[params.dataIndex];
          if (duration < 30) return '#f00';
          if (duration < 60) return '#ff0';
          return '#0f0';
        }
      }
    }],
    tooltip: {
      formatter: function(params) {
        return `Session: ${params.name}<br/>Duration: ${params.value}s`;
      }
    }
  };
  
  if (!charts.sessionHistory) {
    charts.sessionHistory = echarts.init(document.getElementById('sessionHistoryChart'));
  }
  charts.sessionHistory.setOption(option);
}

// Initialize charts
function initCharts() {
  charts.activity = echarts.init(document.getElementById('activityChart'));
  charts.status = echarts.init(document.getElementById('statusChart'));
  charts.message = echarts.init(document.getElementById('messageChart'));
  charts.duration = echarts.init(document.getElementById('durationChart'));
  charts.quality = echarts.init(document.getElementById('qualityChart'));
  
  // Set basic options for all charts
  Object.values(charts).forEach(chart => {
    chart.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: '#0ff' }
    });
  });
}

// Fetch data from API
async function fetchData() {
  try {
    const startTime = performance.now();
    elements.apiStatus.textContent = 'Fetching...';
    elements.connectionStatus.textContent = 'Updating data...';
    
    const [stats, instances, health] = await Promise.all([
      fetchJson('/api/stats'),
      fetchJson('/api/instances'),
      fetchJson('/api/instance-health') // New endpoint
    ]);
    
    // Cache instances for detail view
    appState.instanceCache = instances.instances;
    
    const fetchDuration = (performance.now() - startTime).toFixed(2);
    elements.apiStatus.textContent = `OK (${fetchDuration}ms)`;
    elements.connectionStatus.textContent = 'Connected';
    elements.connectionStatus.style.color = '#0f0';
    
    // Update last update time
    appState.lastUpdate = new Date(stats.lastUpdate);
    elements.lastUpdate.textContent = appState.lastUpdate.toLocaleTimeString();
    
    // Update stats
    updateStats(stats, instances, health);
    
    // Update charts
    updateCharts(stats, instances, health);
    
    // Update instance table
    updateInstanceTable(instances, health);
    
    // Check for alerts
    checkAlerts(stats, instances);
    
  } catch (error) {
    console.error('Failed to fetch data:', error);
    elements.apiStatus.textContent = 'Error';
    elements.apiStatus.style.color = '#f00';
    elements.connectionStatus.textContent = 'Connection failed';
    elements.connectionStatus.style.color = '#f00';
  }
}

function checkAlerts(stats, instances) {
  const newAlerts = [];
  
  // Check system health
  if (stats.statistics.qualityMetrics.healthScore < CONFIG.healthThresholds.warning) {
    newAlerts.push({
      type: 'system',
      message: `System health critical (${stats.statistics.qualityMetrics.healthScore}/100)`,
      timestamp: Date.now(),
      level: 'critical'
    });
  }
  
  // Check for instances with issues
  Object.entries(instances.instances).forEach(([id, instance]) => {
    if (instance.healthScore < CONFIG.healthThresholds.warning) {
      newAlerts.push({
        type: 'instance',
        instanceId: id,
        message: `Instance ${id.substring(0, 6)} health score low (${instance.healthScore}/100)`,
        timestamp: Date.now(),
        level: instance.healthScore < CONFIG.healthThresholds.critical ? 'critical' : 'warning'
      });
    }
    
    if (instance.qualityIssues && instance.qualityIssues.includes('frequent_reconnections')) {
      newAlerts.push({
        type: 'instance',
        instanceId: id,
        message: `Instance ${id.substring(0, 6)} reconnecting frequently`,
        timestamp: Date.now(),
        level: 'warning'
      });
    }
  });
  
  // Update alerts if different from previous
  if (JSON.stringify(newAlerts) !== JSON.stringify(appState.activeAlerts)) {
    appState.activeAlerts = newAlerts;
    updateAlertsDisplay(newAlerts);
  }
}

function updateAlertsDisplay(alerts) {
  // Update alert banner
  if (alerts.length > 0) {
    const criticalAlerts = alerts.filter(a => a.level === 'critical');
    if (criticalAlerts.length > 0) {
      elements.alertMessage.textContent = `${criticalAlerts.length} CRITICAL ISSUES DETECTED`;
      elements.alertBanner.style.display = 'flex';
      elements.alertBanner.style.backgroundColor = 'rgba(255, 50, 50, 0.3)';
      elements.alertBanner.style.borderLeftColor = '#f00';
    } else {
      elements.alertMessage.textContent = `${alerts.length} warnings detected`;
      elements.alertBanner.style.display = 'flex';
      elements.alertBanner.style.backgroundColor = 'rgba(255, 165, 0, 0.3)';
      elements.alertBanner.style.borderLeftColor = '#ff0';
    }
  } else {
    elements.alertBanner.style.display = 'none';
  }
  
  // Update issues list
  elements.issuesList.innerHTML = '';
  if (alerts.length > 0) {
    alerts.slice(0, 5).forEach(alert => {
      const alertItem = document.createElement('div');
      alertItem.className = 'issue-item';
      alertItem.innerHTML = `
        <span>${alert.message}</span>
        <span class="timestamp">${new Date(alert.timestamp).toLocaleTimeString()}</span>
      `;
      elements.issuesList.appendChild(alertItem);
    });
    
    if (alerts.length > 5) {
      const moreItem = document.createElement('div');
      moreItem.className = 'issue-item';
      moreItem.textContent = `+ ${alerts.length - 5} more issues...`;
      elements.issuesList.appendChild(moreItem);
    }
  } else {
    const noIssues = document.createElement('div');
    noIssues.className = 'no-issues';
    noIssues.textContent = 'No critical issues detected';
    elements.issuesList.appendChild(noIssues);
  }
}

// Update stats display
function updateStats(stats, instances, health) {
  // Basic stats
  elements.totalInstances.textContent = stats.totalInstances;
  elements.activeInstances.textContent = stats.activeInstances;
  elements.totalConnections.textContent = stats.statistics.totalConnections;
  elements.totalReconnections.textContent = stats.statistics.reconnections;
  elements.totalUsers.textContent = stats.totalUsers;
  elements.activeUsers.textContent = stats.activeUsers;
  elements.totalMessages.textContent = stats.statistics.totalMessages;
  elements.failedConnections.textContent = stats.statistics.sessionMetrics.failedConnections;
  
  // Health metrics
  const avgDuration = stats.statistics.sessionMetrics.avgDuration || 0;
  elements.avgSessionDuration.textContent = `${Math.round(avgDuration / 1000)}s`;
  
  const healthScore = stats.statistics.qualityMetrics.healthScore || 100;
  elements.healthScore.textContent = healthScore;
  elements.healthBar.style.width = `${healthScore}%`;
  elements.healthStatus.textContent = getHealthStatus(healthScore);
  elements.healthBar.style.background = getHealthColor(healthScore);
  
  elements.stabilityScore.textContent = `${stats.statistics.qualityMetrics.stabilityScore || 100}%`;
  
  // Calculate trends if we have previous data
  if (appState.previousStats) {
    updateTrend('instance', stats.totalInstances, appState.previousStats.totalInstances);
    updateTrend('active', stats.activeInstances, appState.previousStats.activeInstances);
    updateTrend('connection', stats.statistics.totalConnections, appState.previousStats.statistics.totalConnections);
    updateTrend('reconnection', stats.statistics.reconnections, appState.previousStats.statistics.reconnections);
    updateTrend('user', stats.totalUsers, appState.previousStats.totalUsers);
    updateTrend('activeUser', stats.activeUsers, appState.previousStats.activeUsers);
    updateTrend('message', stats.statistics.totalMessages, appState.previousStats.statistics.totalMessages);
    updateTrend('failed', stats.statistics.sessionMetrics.failedConnections, appState.previousStats.statistics.sessionMetrics.failedConnections);
  }
  
  appState.previousStats = stats;
}

function getHealthStatus(score) {
  if (score >= CONFIG.healthThresholds.excellent) return 'Excellent';
  if (score >= CONFIG.healthThresholds.good) return 'Good';
  if (score >= CONFIG.healthThresholds.warning) return 'Warning';
  return 'Critical';
}

function getHealthColor(score) {
  if (score >= CONFIG.healthThresholds.excellent) return '#0f0';
  if (score >= CONFIG.healthThresholds.good) return '#7f0';
  if (score >= CONFIG.healthThresholds.warning) return '#ff0';
  return '#f00';
}

// Update charts
function updateCharts(stats, instances, health) {
  // Activity chart (line)
  charts.activity.setOption({
    xAxis: {
      type: 'category',
      data: Object.keys(stats.statistics.dailyActive),
      axisLabel: { color: '#0ff' }
    },
    yAxis: {
      type: 'value',
      name: 'Activity',
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
  
  // Duration chart (bar)
  const durations = stats.statistics.sessionMetrics;
  charts.duration.setOption({
    xAxis: {
      type: 'category',
      data: ['Min', 'Avg', 'Max'],
      axisLabel: { color: '#0ff' }
    },
    yAxis: {
      type: 'value',
      name: 'Duration (ms)',
      axisLabel: { color: '#0ff' }
    },
    series: [{
      data: [
        { value: durations.minDuration, itemStyle: { color: '#f00' }},
        { value: durations.avgDuration, itemStyle: { color: '#ff0' }},
        { value: durations.maxDuration, itemStyle: { color: '#0f0' }}
      ],
      type: 'bar',
      label: {
        show: true,
        position: 'top',
        formatter: '{@value}ms'
      }
    }]
  });
  
  // Quality chart (radar)
  charts.quality.setOption({
    radar: {
      indicator: [
        { name: 'Health', max: 100 },
        { name: 'Stability', max: 100 },
        { name: 'Sessions', max: durations.maxDuration || 10000 },
        { name: 'Reconnects', max: stats.statistics.reconnections * 10 || 10 },
        { name: 'Uptime', max: 100 }
      ],
      axisName: {
        color: '#0ff'
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: [
          stats.statistics.qualityMetrics.healthScore,
          stats.statistics.qualityMetrics.stabilityScore,
          durations.avgDuration,
          stats.statistics.reconnections,
          (stats.statistics.uptime || 100)
        ],
        areaStyle: {
          color: 'rgba(0, 255, 255, 0.4)'
        },
        lineStyle: {
          color: '#0ff'
        }
      }]
    }]
  });
}

// Update instance table
function updateInstanceTable(instances, health) {
  const tbody = elements.instancesTable;
  tbody.innerHTML = '';
  
  const now = Date.now();
  const sortedInstances = Object.entries(instances.instances)
    .sort((a, b) => b[1].lastActive - a[1].lastActive);
  
  sortedInstances.forEach(([id, instance]) => {
    const row = document.createElement('tr');
    row.className = 'instance-row';
    row.dataset.instanceId = id;
    
    // Status indicator
    const status = instance.status === 'connected' && 
      (now - instance.lastActive) < CONFIG.timeouts.concurrent ?
      'active' : 'inactive';
    
    // Health indicator
    const healthScore = instance.healthScore || 100;
    const healthStatus = getHealthStatus(healthScore);
    const healthColor = getHealthColor(healthScore);
    
    // Last active time
    const lastActive = new Date(instance.lastActive);
    const lastActiveStr = lastActive.toLocaleTimeString();
    
    // Session duration
    const sessionDuration = instance.avgSessionDuration ? 
      `${Math.round(instance.avgSessionDuration / 1000)}s` : 'N/A';
    
    // Issues
    const issues = instance.qualityIssues?.length || 0;
    
    row.innerHTML = `
      <td>
        <span class="status-indicator status-${status}"></span>
        ${id.substring(0, 8)}...
      </td>
      <td>
        <div class="health-cell">
          <div class="health-bar-small">
            <div class="health-progress-small" style="width: ${healthScore}%; background: ${healthColor}"></div>
          </div>
          <span>${healthScore}</span>
        </div>
      </td>
      <td>${sessionDuration}</td>
      <td>${status.toUpperCase()}</td>
      <td>${issues} ${issues === 1 ? 'issue' : 'issues'}</td>
      <td>
        <button class="action-btn" onclick="showInstanceDetails('${id}')">Details</button>
      </td>
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

// Make function available globally
window.showInstanceDetails = showInstanceDetails;