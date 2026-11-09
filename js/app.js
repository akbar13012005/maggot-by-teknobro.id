/* ============================================
   TeknoBro - Monitoring Suhu Maggot
   Main Application JavaScript
   ============================================ */

// ==========================================
// ========== FIREBASE CONFIG ==============
// ==========================================
// Ganti dengan konfigurasi Firebase milik Anda
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBpcvH685A8w3iMnRtN6k0eqHcmZDrpQDE",
    authDomain: "maggot-iot-5e285.firebaseapp.com",
    databaseURL: "https://maggot-iot-5e285-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "maggot-iot-5e285",
    storageBucket: "maggot-iot-5e285.firebasestorage.app",
    messagingSenderId: "553245663212",
    appId: "1:553245663212:web:76046f6b2ee42eb0d3eac9"
};

// ==========================================
// ========== APP STATE ====================
// ==========================================
const state = {
    isDemo: true,
    isOnline: false,
    mode: 'auto',
    targetSuhu: 30.0,
    kipas_peltier: false,
    lampu_pemanas: false,
    suhuMedia: 0,
    kelembaban: 0,
    trendData: [],
    historyData: [],
    demoInterval: null,
    currentPage: 'monitoring',
    wifiConfig: {
        slot1: { ssid: 'Home_WiFi_2.4G', pass: 'maggot2024' },
        slot2: { ssid: 'Hotspot_TeknoBro', pass: 'teknobro123' },
        slot3: { ssid: 'Kandang_Maggot_IoT', pass: 'bsfberkah' }
    },
    wifiStatus: {
        currentSsid: 'Home_WiFi_2.4G',
        rssi: -52,
        ip: '192.168.1.45',
        activeSlot: 1
    }
};

let trendChart = null;
let historyChart = null;
let db = null;

// ==========================================
// ========== INITIALIZATION ===============
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    initDateFilters();
    initFirebase();
    initPWA();

    if (state.isDemo) {
        startDemoMode();
    } else {
        updateControlUI();
        updateSummaryUI();
        updateStatusUI();
    }
});

function initFirebase() {
    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === "") {
        console.log('⚠️ Firebase belum dikonfigurasi. Menjalankan mode demo.');
        state.isDemo = true;
        document.getElementById('demoBanner').style.display = 'flex';
        return;
    }

    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        state.isDemo = false;
        document.getElementById('demoBanner').style.display = 'none';
        listenToFirebase();
        showToast('Terhubung ke Firebase', 'success');
    } catch (error) {
        console.error('Firebase init error:', error);
        state.isDemo = true;
        document.getElementById('demoBanner').style.display = 'flex';
        showToast('Gagal terhubung Firebase. Mode demo aktif.', 'warning');
    }
}

// ==========================================
// ========== FIREBASE LISTENERS ===========
// ==========================================
function listenToFirebase() {
    if (!db) return;

    // Listen to sensor data
    db.ref('sensor').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.suhuMedia = data.suhu_media || 0;
            state.kelembaban = data.kelembaban || 0;
            updateMonitoringUI();
            addTrendPoint(data);
        } else {
            document.getElementById('val-suhu-media').textContent = '--.-°C';
            document.getElementById('status-suhu-media').textContent = 'Menunggu ESP32...';
            document.getElementById('status-suhu-media').className = 'stat-status dingin';
            document.getElementById('val-kelembaban').textContent = '--.-%';
            document.getElementById('status-kelembaban').textContent = 'RH';
        }
    });

    // Listen to control state
    db.ref('control').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.mode = data.mode || 'auto';
            state.targetSuhu = (data.target_suhu !== undefined) ? data.target_suhu : 30.0;
            state.kipas_peltier = data.kipas_peltier || false;
            state.lampu_pemanas = data.lampu_pemanas || false;
            updateControlUI();
            updateSummaryUI();
        } else {
            // Inisialisasi awal di Firebase jika masih kosong
            db.ref('control').set({
                mode: 'auto',
                target_suhu: 30.0,
                kipas_peltier: false,
                lampu_pemanas: false
            });
        }
    });

    // Listen to device status
    db.ref('status').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.isOnline = data.online || false;
            if (data.wifi_ssid) state.wifiStatus.currentSsid = data.wifi_ssid;
            if (data.wifi_rssi) state.wifiStatus.rssi = data.wifi_rssi;
            if (data.ip) state.wifiStatus.ip = data.ip;
            if (data.active_slot) state.wifiStatus.activeSlot = data.active_slot;
        } else {
            state.isOnline = false;
        }
        updateStatusUI();
        updateWiFiStatusUI();
    });

    // Listen to WiFi config
    db.ref('wifi_config').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.wifiConfig = data;
            loadWiFiConfigToInputs(data);
        }
    });

    // Listen for connection state
    db.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            console.log('Connected to Firebase');
        }
    });
}

// ==========================================
// ========== DEMO MODE ====================
// ==========================================
function startDemoMode() {
    state.isOnline = true;
    state.mode = 'auto';
    state.targetSuhu = 30.0;
    state.suhuMedia = 30.0;
    state.kelembaban = 68.0;

    updateMonitoringUI();
    updateControlUI();
    updateStatusUI();
    updateSummaryUI();

    // Generate initial trend data (last 60 minutes)
    const now = Date.now();
    for (let i = 60; i >= 0; i--) {
        const time = new Date(now - i * 60000);
        state.trendData.push({
            time: time,
            suhu_media: 29 + Math.random() * 3,
            kelembaban: 65 + Math.random() * 10
        });
    }
    updateTrendChart();

    // Generate demo history
    for (let i = 200; i >= 0; i--) {
        const time = new Date(now - i * 300000); // every 5 min
        state.historyData.push({
            timestamp: time.getTime(),
            suhu_media: (29 + Math.random() * 3).toFixed(1),
            kelembaban: (65 + Math.random() * 10).toFixed(1),
            target: 30.0,
            mode: 'auto'
        });
    }

    // Simulate real-time updates
    state.demoInterval = setInterval(() => {
        // Simulate sensor variations
        state.suhuMedia += (Math.random() - 0.5) * 0.4;
        state.kelembaban += (Math.random() - 0.5) * 0.8;

        // Keep within realistic range
        state.suhuMedia = Math.max(25, Math.min(40, state.suhuMedia));
        state.kelembaban = Math.max(50, Math.min(90, state.kelembaban));

        // Auto mode logic simulation
        if (state.mode === 'auto') {
            if (state.suhuMedia > state.targetSuhu + 1) {
                state.kipas_peltier = true;
                state.lampu_pemanas = false;
            } else if (state.suhuMedia < state.targetSuhu - 1) {
                state.kipas_peltier = false;
                state.lampu_pemanas = true;
            } else {
                state.kipas_peltier = false;
                state.lampu_pemanas = false;
            }
        }

        updateMonitoringUI();
        updateControlUI();
        updateSummaryUI();

        // Add trend point
        const now = new Date();
        state.trendData.push({
            time: now,
            suhu_media: state.suhuMedia,
            kelembaban: state.kelembaban
        });

        // Keep only last 60 data points
        if (state.trendData.length > 60) {
            state.trendData.shift();
        }

        updateTrendChart();
    }, 3000); // Update every 3 seconds for demo
}

// ==========================================
// ========== UI UPDATE FUNCTIONS ==========
// ==========================================
function updateMonitoringUI() {
    // Update stat values
    document.getElementById('val-suhu-media').textContent = state.suhuMedia.toFixed(1) + '°C';
    document.getElementById('val-kelembaban').textContent = state.kelembaban.toFixed(1) + '%';
    document.getElementById('val-target').textContent = state.targetSuhu.toFixed(1) + '°C';

    // Update suhu status
    const suhuStatus = document.getElementById('status-suhu-media');
    const diff = state.suhuMedia - state.targetSuhu;
    if (Math.abs(diff) <= 1) {
        suhuStatus.textContent = 'Ideal';
        suhuStatus.className = 'stat-status ideal';
    } else if (diff < -1) {
        suhuStatus.textContent = 'Di bawah target';
        suhuStatus.className = 'stat-status dingin';
    } else if (diff > 1 && diff <= 3) {
        suhuStatus.textContent = 'Sedikit panas';
        suhuStatus.className = 'stat-status hangat';
    } else {
        suhuStatus.textContent = 'Terlalu panas!';
        suhuStatus.className = 'stat-status panas';
    }

    // Update kelembaban status
    const kelStatus = document.getElementById('status-kelembaban');
    kelStatus.textContent = 'RH';
    kelStatus.className = 'stat-status';

    // Update mode status
    const modeStatus = document.getElementById('status-mode');
    modeStatus.textContent = 'Mode ' + (state.mode === 'auto' ? 'Auto' : 'Manual');
    modeStatus.className = 'stat-status ' + (state.mode === 'auto' ? 'ideal' : 'hangat');

    // Update gauge
    updateGauge(state.suhuMedia);
}

function updateGauge(temp) {
    // Map temperature 20-45 to arc length (0-377)
    const minTemp = 20;
    const maxTemp = 45;
    const totalArc = 377;

    const clampedTemp = Math.max(minTemp, Math.min(maxTemp, temp));
    const ratio = (clampedTemp - minTemp) / (maxTemp - minTemp);
    const arcLen = ratio * totalArc;

    const arc = document.getElementById('gaugeArc');
    arc.setAttribute('stroke-dasharray', `${arcLen}, ${totalArc}`);

    // Update needle rotation (-90 to 90 degrees)
    const angle = -90 + (ratio * 180);
    const needle = document.getElementById('gaugeNeedle');
    needle.setAttribute('transform', `rotate(${angle}, 150, 170)`);

    // Update display value
    document.getElementById('gaugeTemp').textContent = temp.toFixed(1);
}

function updateControlUI() {
    // Mode buttons
    const btnAuto = document.getElementById('btn-mode-auto');
    const btnManual = document.getElementById('btn-mode-manual');

    btnAuto.classList.toggle('active', state.mode === 'auto');
    btnManual.classList.toggle('active', state.mode === 'manual');

    // Target
    document.getElementById('targetInput').value = state.targetSuhu.toFixed(1);
    document.getElementById('targetSlider').value = state.targetSuhu;

    // Manual controls
    const isManual = state.mode === 'manual';
    const manualHint = document.getElementById('manualHint');
    manualHint.textContent = isManual
        ? 'Anda dapat mengontrol perangkat secara manual'
        : 'Aktifkan mode Manual untuk mengontrol perangkat secara langsung';

    const cardKipas = document.getElementById('card-kipas');
    const cardLampu = document.getElementById('card-lampu');
    cardKipas.classList.toggle('disabled', !isManual);
    cardLampu.classList.toggle('disabled', !isManual);

    // Toggle switches
    const toggleKipas = document.getElementById('toggle-kipas');
    const toggleLampu = document.getElementById('toggle-lampu');
    toggleKipas.disabled = !isManual;
    toggleLampu.disabled = !isManual;
    toggleKipas.checked = state.kipas_peltier;
    toggleLampu.checked = state.lampu_pemanas;

    // Device status rings
    const ringKipas = document.getElementById('ring-kipas');
    const ringLampu = document.getElementById('ring-lampu');
    ringKipas.classList.toggle('active', state.kipas_peltier);
    ringLampu.classList.toggle('active', state.lampu_pemanas);

    // Device status text
    const statusKipas = document.getElementById('device-status-kipas');
    const statusLampu = document.getElementById('device-status-lampu');
    statusKipas.textContent = state.kipas_peltier ? 'ON' : 'OFF';
    statusKipas.classList.toggle('on', state.kipas_peltier);
    statusLampu.textContent = state.lampu_pemanas ? 'ON' : 'OFF';
    statusLampu.classList.toggle('on', state.lampu_pemanas);

    // Fan animation
    const iconKipas = document.getElementById('icon-kipas');
    iconKipas.classList.toggle('fan-spinning', state.kipas_peltier);
}

function updateStatusUI() {
    const badge = document.getElementById('statusBadge');
    const text = document.getElementById('statusText');
    const mobileDot = document.getElementById('mobile-status-dot');

    if (state.isOnline) {
        badge.className = 'status-badge online';
        text.textContent = 'ONLINE';
        mobileDot.className = 'status-dot online';
    } else {
        badge.className = 'status-badge offline';
        text.textContent = 'OFFLINE';
        mobileDot.className = 'status-dot offline';
    }

    // Sidebar summary status
    document.getElementById('summary-status').innerHTML = state.isOnline
        ? '<span class="status-dot online"></span> Online'
        : '<span class="status-dot offline"></span> Offline';
}

function updateSummaryUI() {
    document.getElementById('summary-mode').textContent = state.mode === 'auto' ? 'Auto' : 'Manual';
    document.getElementById('summary-target').textContent = state.targetSuhu.toFixed(1) + '°C';
    document.getElementById('summary-kipas').textContent = state.kipas_peltier ? 'ON' : 'OFF';
    document.getElementById('summary-pemanas').textContent = state.lampu_pemanas ? 'ON' : 'OFF';
}

// ==========================================
// ========== CONTROL ACTIONS ==============
// ==========================================
function setMode(mode) {
    state.mode = mode;

    if (!state.isDemo && db) {
        db.ref('control/mode').set(mode);
    }

    updateControlUI();
    updateSummaryUI();
    updateMonitoringUI();
    showToast(`Mode diubah ke ${mode === 'auto' ? 'Auto' : 'Manual'}`, 'info');
}

function setTarget(value) {
    const temp = parseFloat(value);
    if (isNaN(temp) || temp < 20 || temp > 45) return;

    state.targetSuhu = temp;
    document.getElementById('targetInput').value = temp.toFixed(1);
    document.getElementById('targetSlider').value = temp;

    if (!state.isDemo && db) {
        db.ref('control/target_suhu').set(temp);
    }

    updateMonitoringUI();
    updateSummaryUI();
}

function adjustTarget(delta) {
    let newVal = state.targetSuhu + delta;
    newVal = Math.max(20, Math.min(45, newVal));
    setTarget(newVal);
}

function toggleDevice(device, isOn) {
    if (state.mode !== 'manual') {
        showToast('Aktifkan mode Manual terlebih dahulu', 'warning');
        return;
    }

    state[device] = isOn;

    if (!state.isDemo && db) {
        db.ref(`control/${device}`).set(isOn);
    }

    updateControlUI();
    updateSummaryUI();

    const deviceName = device === 'kipas_peltier' ? 'Pendingin' : 'Pemanas';
    showToast(`${deviceName} ${isOn ? 'dihidupkan' : 'dimatikan'}`, isOn ? 'success' : 'info');
}

// ==========================================
// ========== CHARTS =======================
// ==========================================
function initCharts() {
    // Chart.js global defaults
    Chart.defaults.color = '#7b89a8';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;

    initTrendChart();
    initHistoryChart();
}

function initTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');

    const gradientMedia = ctx.createLinearGradient(0, 0, 0, 240);
    gradientMedia.addColorStop(0, 'rgba(239, 83, 80, 0.25)');
    gradientMedia.addColorStop(1, 'rgba(239, 83, 80, 0)');

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Suhu Media',
                    data: [],
                    borderColor: '#ef5350',
                    backgroundColor: gradientMedia,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHitRadius: 10,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#ef5350'
                },
                {
                    label: 'Kelembaban (%)',
                    data: [],
                    borderColor: '#ffa726',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHitRadius: 10,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#ffa726',
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                    backgroundColor: 'rgba(8, 14, 40, 0.95)',
                    borderColor: 'rgba(0, 180, 216, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { weight: '600' },
                    callbacks: {
                        label: function(context) {
                            const unit = context.datasetIndex === 1 ? '%' : '°C';
                            return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    title: { display: true, text: 'Suhu (°C)', font: { size: 10 } },
                    suggestedMin: 25,
                    suggestedMax: 38
                },
                y1: {
                    position: 'right',
                    grid: { display: false },
                    title: { display: true, text: 'Kelembaban (%)', font: { size: 10 } },
                    suggestedMin: 50,
                    suggestedMax: 95
                }
            },
            animation: { duration: 500 }
        }
    });
}

function initHistoryChart() {
    const ctx = document.getElementById('historyChart').getContext('2d');

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Suhu Media',
                    data: [],
                    borderColor: '#ef5350',
                    backgroundColor: 'rgba(239, 83, 80, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 1,
                    pointHoverRadius: 5
                },
                {
                    label: 'Kelembaban (%)',
                    data: [],
                    borderColor: '#ffa726',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                    backgroundColor: 'rgba(8, 14, 40, 0.95)',
                    borderColor: 'rgba(0, 180, 216, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const unit = context.datasetIndex === 1 ? '%' : '°C';
                            return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    ticks: { maxTicksLimit: 10 }
                },
                y: {
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    title: { display: true, text: 'Suhu (°C)', font: { size: 10 } }
                },
                y1: {
                    position: 'right',
                    grid: { display: false },
                    title: { display: true, text: 'Kelembaban (%)', font: { size: 10 } }
                }
            },
            animation: { duration: 500 }
        }
    });
}

function updateTrendChart() {
    if (!trendChart || state.trendData.length === 0) return;

    const labels = state.trendData.map(d => {
        const t = d.time;
        return t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
    });

    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = state.trendData.map(d => parseFloat(d.suhu_media.toFixed(1)));
    trendChart.data.datasets[1].data = state.trendData.map(d => parseFloat(d.kelembaban.toFixed(1)));
    trendChart.update('none');
}

function addTrendPoint(data) {
    const now = new Date();
    state.trendData.push({
        time: now,
        suhu_media: data.suhu_media,
        kelembaban: data.kelembaban
    });

    if (state.trendData.length > 60) {
        state.trendData.shift();
    }

    updateTrendChart();
}

// ==========================================
// ========== HISTORY & CSV ================
// ==========================================
function initDateFilters() {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    document.getElementById('dateTo').value = formatDateInput(today);
    document.getElementById('dateFrom').value = formatDateInput(weekAgo);
}

function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

function loadHistory() {
    const limit = parseInt(document.getElementById('dataLimit').value);
    let data = [...state.historyData];

    // Date filter
    const fromVal = document.getElementById('dateFrom').value;
    const toVal = document.getElementById('dateTo').value;

    if (fromVal) {
        const from = new Date(fromVal).getTime();
        data = data.filter(d => d.timestamp >= from);
    }
    if (toVal) {
        const to = new Date(toVal).getTime() + 86400000; // end of day
        data = data.filter(d => d.timestamp <= to);
    }

    // Limit
    if (limit > 0) {
        data = data.slice(-limit);
    }

    // Update history chart
    updateHistoryChart(data);

    // Update history table
    updateHistoryTable(data);

    // If using Firebase
    if (!state.isDemo && db) {
        let query = db.ref('history').orderByChild('timestamp');

        if (fromVal) {
            query = query.startAt(new Date(fromVal).getTime());
        }
        if (toVal) {
            query = query.endAt(new Date(toVal).getTime() + 86400000);
        }
        if (limit > 0) {
            query = query.limitToLast(limit);
        }

        query.once('value', (snapshot) => {
            const firebaseData = [];
            snapshot.forEach(child => {
                firebaseData.push(child.val());
            });
            state.historyData = firebaseData;
            updateHistoryChart(firebaseData);
            updateHistoryTable(firebaseData);
        });
    }
}

function updateHistoryChart(data) {
    if (!historyChart) return;

    const labels = data.map(d => {
        const ms = d.timestamp < 10000000000 ? d.timestamp * 1000 : d.timestamp;
        const t = new Date(ms);
        return t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) + ' ' +
               t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    });

    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = data.map(d => parseFloat(d.suhu_media));
    historyChart.data.datasets[1].data = data.map(d => parseFloat(d.kelembaban));
    historyChart.update();
}

function updateHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    const countEl = document.getElementById('dataCount');

    countEl.textContent = `${data.length} data`;

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-database"></i>
                    <p>Tidak ada data untuk periode ini</p>
                </td>
            </tr>`;
        return;
    }

    // Show latest first
    const reversed = [...data].reverse();

    tbody.innerHTML = reversed.map((d, idx) => {
        const ms = d.timestamp < 10000000000 ? d.timestamp * 1000 : d.timestamp;
        const t = new Date(ms);
        const dateStr = t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return `<tr>
            <td>${idx + 1}</td>
            <td>${dateStr} ${timeStr}</td>
            <td>${parseFloat(d.suhu_media).toFixed(1)}°C</td>
            <td>${parseFloat(d.kelembaban).toFixed(1)}%</td>
            <td>${parseFloat(d.target || state.targetSuhu).toFixed(1)}°C</td>
            <td><span class="stat-status ${d.mode === 'auto' ? 'ideal' : 'hangat'}">${d.mode === 'auto' ? 'Auto' : 'Manual'}</span></td>
        </tr>`;
    }).join('');
}

function exportCSV() {
    let data = state.historyData;

    if (data.length === 0 && state.trendData.length > 0) {
        // If no history, export trend data
        data = state.trendData.map(d => ({
            timestamp: d.time.getTime(),
            suhu_media: d.suhu_media.toFixed(1),
            kelembaban: d.kelembaban.toFixed(1),
            target: state.targetSuhu,
            mode: state.mode
        }));
    }

    if (data.length === 0) {
        showToast('Tidak ada data untuk diekspor', 'warning');
        return;
    }

    // Build CSV
    const headers = ['No', 'Tanggal', 'Waktu', 'Suhu Media (°C)', 'Kelembaban (%)', 'Target (°C)', 'Mode'];
    let csv = '\uFEFF'; // BOM for Excel compatibility
    csv += headers.join(',') + '\n';

    data.forEach((d, idx) => {
        const ms = d.timestamp < 10000000000 ? d.timestamp * 1000 : d.timestamp;
        const t = new Date(ms);
        const date = t.toLocaleDateString('id-ID');
        const time = t.toLocaleTimeString('id-ID');
        csv += `${idx + 1},${date},${time},${d.suhu_media},${d.kelembaban},${d.target || state.targetSuhu},${d.mode || state.mode}\n`;
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const filename = `TeknoBro_Data_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}.csv`;

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`CSV berhasil diunduh (${data.length} data)`, 'success');
}

// ==========================================
// ========== NAVIGATION ===================
// ==========================================
function navigateTo(page, event) {
    if (event) event.preventDefault();

    state.currentPage = page;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`page-${page}`).classList.add('active');

    // Load history data when navigating to riwayat
    if (page === 'riwayat') {
        loadHistory();
    }

    // Close mobile sidebar
    closeSidebar();
}

// ==========================================
// ========== SIDEBAR MOBILE ===============
// ==========================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
}

document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

// ==========================================
// ========== TOAST NOTIFICATIONS ==========
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ==========================================
// ========== JARINGAN WIFI =================
// ==========================================
function loadWiFiConfigToInputs(cfg) {
    if (!cfg) return;
    if (cfg.slot1) {
        if (cfg.slot1.ssid !== undefined) document.getElementById('wifi-ssid-1').value = cfg.slot1.ssid;
        if (cfg.slot1.pass !== undefined) document.getElementById('wifi-pass-1').value = cfg.slot1.pass;
    }
    if (cfg.slot2) {
        if (cfg.slot2.ssid !== undefined) document.getElementById('wifi-ssid-2').value = cfg.slot2.ssid;
        if (cfg.slot2.pass !== undefined) document.getElementById('wifi-pass-2').value = cfg.slot2.pass;
    }
    if (cfg.slot3) {
        if (cfg.slot3.ssid !== undefined) document.getElementById('wifi-ssid-3').value = cfg.slot3.ssid;
        if (cfg.slot3.pass !== undefined) document.getElementById('wifi-pass-3').value = cfg.slot3.pass;
    }
}

function saveWiFiConfig() {
    const slot1 = {
        ssid: document.getElementById('wifi-ssid-1').value.trim(),
        pass: document.getElementById('wifi-pass-1').value
    };
    const slot2 = {
        ssid: document.getElementById('wifi-ssid-2').value.trim(),
        pass: document.getElementById('wifi-pass-2').value
    };
    const slot3 = {
        ssid: document.getElementById('wifi-ssid-3').value.trim(),
        pass: document.getElementById('wifi-pass-3').value
    };

    if (!slot1.ssid && !slot2.ssid && !slot3.ssid) {
        showToast('Minimal masukkan 1 nama WiFi (SSID)', 'warning');
        return;
    }

    const payload = {
        slot1: slot1,
        slot2: slot2,
        slot3: slot3,
        updated_at: Date.now()
    };

    state.wifiConfig = payload;

    if (!state.isDemo && db) {
        db.ref('wifi_config').set(payload)
            .then(() => {
                showToast('Pengaturan 3 WiFi berhasil dikirim ke ESP32!', 'success');
            })
            .catch(err => {
                console.error(err);
                showToast('Gagal menyimpan ke Firebase', 'error');
            });
    } else {
        // Demo mode
        showToast('Mode Demo: 3 Profil WiFi disimpan (Simulasi)', 'success');
    }
}

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    const icon = btnEl.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function updateWiFiStatusUI() {
    const ssidEl = document.getElementById('wifi-current-ssid');
    const rssiEl = document.getElementById('wifi-current-rssi');
    const ipEl = document.getElementById('wifi-current-ip');

    if (ssidEl) ssidEl.textContent = state.wifiStatus.currentSsid || '-';
    if (ipEl) ipEl.textContent = state.wifiStatus.ip || '-';

    if (rssiEl) {
        const rssi = state.wifiStatus.rssi;
        let quality = 'Sangat Baik';
        if (rssi < -80) quality = 'Lemah';
        else if (rssi < -70) quality = 'Cukup';
        else if (rssi < -60) quality = 'Baik';

        rssiEl.innerHTML = `${rssi} dBm <small class="signal-tag">(${quality})</small>`;
    }

    // Update active slot badges
    for (let i = 1; i <= 3; i++) {
        const badge = document.getElementById(`slot${i}-status`);
        if (badge) {
            const isActive = state.wifiStatus.activeSlot === i;
            badge.className = `slot-status ${isActive ? 'active' : 'standby'}`;
            badge.textContent = isActive ? 'Terhubung' : 'Siaga';
        }
    }
}

// ==========================================
// ========== PWA INSTALLATION ==============
// ==========================================
let deferredPrompt = null;

function initPWA() {
    // Daftarkan Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((reg) => {
                    console.log('✅ PWA Service Worker aktif:', reg.scope);
                })
                .catch((err) => {
                    console.warn('⚠️ Service Worker gagal didaftarkan:', err);
                });
        });
    }

    // Tangkap event sebelum browser memunculkan prompt install
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Tampilkan tombol install di sidebar & mobile header
        const installContainer = document.getElementById('installContainer');
        const mobileInstallBtn = document.getElementById('mobileInstallBtn');

        if (installContainer) installContainer.style.display = 'block';
        if (mobileInstallBtn) mobileInstallBtn.style.display = 'flex';
    });

    // Event ketika aplikasi berhasil di-install
    window.addEventListener('appinstalled', () => {
        console.log('🎉 PWA TeknoBro berhasil dipasang!');
        deferredPrompt = null;

        const installContainer = document.getElementById('installContainer');
        const mobileInstallBtn = document.getElementById('mobileInstallBtn');

        if (installContainer) installContainer.style.display = 'none';
        if (mobileInstallBtn) mobileInstallBtn.style.display = 'none';

        showToast('Aplikasi TeknoBro berhasil dipasang di layar utama!', 'success');
    });
}

function triggerPWAInstall() {
    if (!deferredPrompt) {
        showToast('Gunakan menu browser: "Install TeknoBro" atau "Tambahkan ke Layar Utama"', 'info');
        return;
    }

    deferredPrompt.prompt();

    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            showToast('Memasang TeknoBro ke perangkat...', 'info');
        }
        deferredPrompt = null;
    });
}

// ==========================================
// ========== KEYBOARD SHORTCUTS ===========
// ==========================================
document.addEventListener('keydown', (e) => {
    if (e.altKey) {
        switch(e.key) {
            case '1': navigateTo('monitoring'); break;
            case '2': navigateTo('kontrol'); break;
            case '3': navigateTo('riwayat'); break;
            case '4': navigateTo('wifi'); break;
        }
    }
});
