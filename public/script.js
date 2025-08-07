const total = document.querySelector('#total span');
const concurrent = document.querySelector('#concurrent span');
const disconnected = document.querySelector('#disconnected span');
const lastUpdate = document.querySelector('#lastUpdate span');

let chart;

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        total.textContent = data.totalUsers;
        concurrent.textContent = data.concurrentUsers;
        disconnected.textContent = data.disconnectedUsers;
        lastUpdate.textContent = new Date(data.lastUpdate).toLocaleTimeString();

        updateChart(data);
    } catch (err) {
        total.textContent = concurrent.textContent = disconnected.textContent = 'Error';
        lastUpdate.textContent = '⚠️ API Error';
    }
}

function updateChart(data) {
    if (!chart) {
        chart = new Chart(document.getElementById('chart'), {
            type: 'doughnut',
            data: {
                labels: ['Concurrent', 'Disconnected', 'Others'],
                datasets: [{
                    data: [data.concurrentUsers, data.disconnectedUsers, data.totalUsers - data.concurrentUsers - data.disconnectedUsers],
                    backgroundColor: ['#0ff', '#08f', '#044']
                }]
            }
        });
    } else {
        chart.data.datasets[0].data = [
            data.concurrentUsers,
            data.disconnectedUsers,
            data.totalUsers - data.concurrentUsers - data.disconnectedUsers
        ];
        chart.update();
    }
}

setInterval(fetchStats, 5000);
fetchStats();