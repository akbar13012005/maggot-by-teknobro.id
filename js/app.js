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
    bluetoothEnabled: false,
    bleConnected: false,
    bleDevice: null,
    bleGattServer: null,
    selectedFirmwareFile: null,
    isFlashing: false,
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
    // Prevent accidental multi-touch pinch zoom
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    // Handle orientation change & resize gracefully
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', () => {
        setTimeout(handleWindowResize, 200);
    });

    initCharts();
    initDateFilters();
    initFirebase();
    initPWA();
    updateBluetoothUI();

    if (state.isDemo) {
        startDemoMode();
    } else {
        updateControlUI();
        updateSummaryUI();
        updateStatusUI();
    }
});

function handleWindowResize() {
    if (trendChart) trendChart.resize();
    if (historyChart) historyChart.resize();
}

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

    // Listen to Bluetooth power state from Firebase
    db.ref('control/bluetooth').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val !== null) {
            state.bluetoothEnabled = (typeof val === 'boolean') ? val : (val.enabled || false);
            updateBluetoothUI();
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
    const suhuMediaEl = document.getElementById('val-suhu-media');
    const kelembabanEl = document.getElementById('val-kelembaban');
    const targetEl = document.getElementById('val-target');

    if (suhuMediaEl) suhuMediaEl.textContent = state.suhuMedia > 0 ? state.suhuMedia.toFixed(1) + '°C' : '--.-°C';
    if (kelembabanEl) kelembabanEl.textContent = state.kelembaban > 0 ? state.kelembaban.toFixed(1) + '%' : '--.-%';
    if (targetEl) targetEl.textContent = state.targetSuhu.toFixed(1) + '°C';

    // Update suhu status
    const suhuStatus = document.getElementById('status-suhu-media');
    if (suhuStatus) {
        if (state.suhuMedia === 0) {
            suhuStatus.textContent = 'Menunggu ESP32...';
            suhuStatus.className = 'stat-status dingin';
        } else {
            const diff = state.suhuMedia - state.targetSuhu;
            if (Math.abs(diff) <= 1) {
                suhuStatus.textContent = 'Suhu Ideal';
                suhuStatus.className = 'stat-status ideal';
            } else if (diff < -1) {
                suhuStatus.textContent = 'Di Bawah Target';
                suhuStatus.className = 'stat-status dingin';
            } else if (diff > 1 && diff <= 3) {
                suhuStatus.textContent = 'Sedikit Panas';
                suhuStatus.className = 'stat-status hangat';
            } else {
                suhuStatus.textContent = 'Terlalu Panas!';
                suhuStatus.className = 'stat-status panas';
            }
        }
    }

    // Update target status badge
    const targetStatus = document.getElementById('status-target');
    if (targetStatus) {
        targetStatus.textContent = 'Mode ' + (state.mode === 'auto' ? 'Auto' : 'Manual');
        targetStatus.className = 'stat-status ' + (state.mode === 'auto' ? 'ideal' : 'hangat');
    }

    // Update gauge
    updateGauge(state.suhuMedia);
}

function updateGauge(temp) {
    const minTemp = 20;
    const maxTemp = 45;
    const totalArc = 267; // Panjang busur SVG gauge (radius 85)

    const val = typeof temp === 'number' && !isNaN(temp) ? temp : 0;
    const clampedTemp = Math.max(minTemp, Math.min(maxTemp, val > 0 ? val : minTemp));
    const ratio = (clampedTemp - minTemp) / (maxTemp - minTemp);
    const offset = totalArc - (ratio * totalArc);

    const fill = document.getElementById('gaugeFill');
    if (fill) {
        fill.style.strokeDashoffset = val > 0 ? offset : totalArc;
    }

    // Update display value
    const tempEl = document.getElementById('gaugeTemp');
    if (tempEl) {
        tempEl.textContent = val > 0 ? val.toFixed(1) : '--.-';
    }
}

function updateControlUI() {
    // Mode buttons
    const btnAuto = document.getElementById('modeAutoBtn');
    const btnManual = document.getElementById('modeManualBtn');

    if (btnAuto) btnAuto.classList.toggle('active', state.mode === 'auto');
    if (btnManual) btnManual.classList.toggle('active', state.mode === 'manual');

    // Target inputs
    const targetInput = document.getElementById('targetInput');
    const targetSlider = document.getElementById('targetSlider');
    if (targetInput) targetInput.value = state.targetSuhu.toFixed(1);
    if (targetSlider) targetSlider.value = state.targetSuhu;

    // Manual controls
    const isManual = state.mode === 'manual';
    const manualHint = document.getElementById('manualHint');
    if (manualHint) {
        manualHint.textContent = isManual
            ? 'Mode Manual aktif — Anda dapat menyalakan/mematikan perangkat langsung'
            : 'Aktifkan mode Manual untuk mengontrol perangkat secara langsung';
    }

    const cardKipas = document.getElementById('card-kipas');
    const cardLampu = document.getElementById('card-lampu');
    if (cardKipas) cardKipas.classList.toggle('disabled', !isManual);
    if (cardLampu) cardLampu.classList.toggle('disabled', !isManual);

    // Toggle switches
    const toggleKipas = document.getElementById('toggle-kipas');
    const toggleLampu = document.getElementById('toggle-lampu');
    if (toggleKipas) {
        toggleKipas.disabled = !isManual;
        toggleKipas.checked = state.kipas_peltier;
    }
    if (toggleLampu) {
        toggleLampu.disabled = !isManual;
        toggleLampu.checked = state.lampu_pemanas;
    }

    // Device status rings
    const ringKipas = document.getElementById('ring-kipas');
    const ringLampu = document.getElementById('ring-lampu');
    if (ringKipas) ringKipas.classList.toggle('active', state.kipas_peltier);
    if (ringLampu) ringLampu.classList.toggle('active', state.lampu_pemanas);

    // Device status text
    const statusKipas = document.getElementById('device-status-kipas');
    const statusLampu = document.getElementById('device-status-lampu');
    if (statusKipas) {
        statusKipas.textContent = state.kipas_peltier ? 'ON' : 'OFF';
        statusKipas.classList.toggle('on', state.kipas_peltier);
    }
    if (statusLampu) {
        statusLampu.textContent = state.lampu_pemanas ? 'ON' : 'OFF';
        statusLampu.classList.toggle('on', state.lampu_pemanas);
    }

    // Fan animation
    const iconKipas = document.getElementById('icon-kipas');
    if (iconKipas) {
        iconKipas.classList.toggle('fan-spinning', state.kipas_peltier);
    }
}

function updateStatusUI() {
    const badge = document.getElementById('liveBadge') || document.getElementById('statusBadge');
    const text = document.getElementById('badgeText') || document.getElementById('statusText');
    const mobileDot = document.getElementById('mobile-status-dot');

    if (badge && text) {
        if (state.isOnline) {
            badge.className = 'live-badge online';
            text.textContent = 'ONLINE';
        } else {
            badge.className = 'live-badge offline';
            text.textContent = 'OFFLINE';
        }
    }

    if (mobileDot) {
        mobileDot.className = 'status-dot ' + (state.isOnline ? 'online' : 'offline');
    }

    // Sidebar summary status
    const summaryStatus = document.getElementById('summary-status');
    if (summaryStatus) {
        summaryStatus.innerHTML = state.isOnline
            ? '<span class="status-dot online"></span> Online'
            : '<span class="status-dot offline"></span> Offline';
    }
}

function updateSummaryUI() {
    const summaryMode = document.getElementById('summary-mode');
    const summaryTarget = document.getElementById('summary-target');

    if (summaryMode) summaryMode.textContent = state.mode === 'auto' ? 'Auto' : 'Manual';
    if (summaryTarget) summaryTarget.textContent = state.targetSuhu.toFixed(1) + '°C';
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
        setTimeout(() => {
            if (historyChart) historyChart.resize();
        }, 120);
    } else if (page === 'monitoring') {
        setTimeout(() => {
            if (trendChart) trendChart.resize();
        }, 120);
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
// ========== FIRMWARE & BLUETOOTH OTA =====
// ==========================================

// Toggle Radio Bluetooth ESP32 (on/off)
function toggleEsp32Bluetooth(enabled) {
    state.bluetoothEnabled = enabled;
    updateBluetoothUI();

    if (!state.isDemo && db) {
        db.ref('control/bluetooth').set({
            enabled: enabled,
            updated_at: Date.now()
        }).then(() => {
            showToast(enabled ? 'Bluetooth ESP32 Diaktifkan (Siap OTA)' : 'Bluetooth ESP32 Dinonaktifkan (Hemat Daya)', 'info');
        }).catch(err => {
            console.error(err);
            showToast('Gagal mengubah status Bluetooth ESP32', 'error');
        });
    } else {
        showToast(enabled ? 'Mode Demo: Bluetooth ESP32 Aktif' : 'Mode Demo: Bluetooth ESP32 Nonaktif', 'info');
    }
}

function updateBluetoothUI() {
    const toggle = document.getElementById('toggle-esp32-ble');
    const badge = document.getElementById('esp32BleStatusBadge');
    const icon = document.getElementById('blePowerIcon');
    const summaryDot = document.getElementById('summary-ble-dot');
    const summaryText = document.getElementById('summary-ble-text');

    const isEnabled = state.bluetoothEnabled;

    if (toggle) toggle.checked = isEnabled;

    if (badge) {
        badge.className = `ble-status-badge ${isEnabled ? 'active' : 'standby'}`;
        badge.innerHTML = `<span class="status-dot ${isEnabled ? 'online' : 'standby'}"></span> ${isEnabled ? 'Aktif (TeknoBro-OTA)' : 'Standby / Nonaktif'}`;
    }

    if (icon) {
        icon.className = `ble-power-icon ${isEnabled ? 'active' : ''}`;
    }

    if (summaryDot && summaryText) {
        summaryDot.className = `status-dot ${isEnabled ? 'online' : 'standby'}`;
        summaryText.textContent = isEnabled ? 'Aktif' : 'Nonaktif';
    }
}

// Koneksi Bluetooth (Web Bluetooth BLE API & Android Native Bridge)
async function handleBleConnect() {
    // 1. Verifikasi Saklar Bluetooth ESP32
    if (!state.bluetoothEnabled) {
        showToast('⚠️ Nyalakan saklar Bluetooth ESP32 terlebih dahulu di sebelah kiri!', 'warning');
        return;
    }

    const btnConnect = document.getElementById('btnBleConnect');
    const btnDisconnect = document.getElementById('btnBleDisconnect');
    const pill = document.getElementById('bleConnPill');
    const deviceNameEl = document.getElementById('bleConnDeviceName');
    const metaInfo = document.getElementById('bleMetaInfo');

    function resetConnectBtn() {
        if (btnConnect) {
            btnConnect.disabled = false;
            btnConnect.style.display = 'inline-flex';
            btnConnect.innerHTML = '<i class="fab fa-bluetooth-b"></i> Hubungkan Bluetooth';
        }
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (pill) {
            pill.className = 'ble-conn-pill disconnected';
            pill.textContent = 'Terputus';
        }
        if (metaInfo) metaInfo.style.display = 'none';
        if (deviceNameEl) deviceNameEl.textContent = 'Belum Terhubung ke ESP32';
        state.bleConnected = false;
        state.bleDevice = null;
        updateStartOtaButtonState();
    }

    // 2. Verifikasi Bluetooth HP Aktif (di APK Android Native)
    if (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') {
        const isBtOn = window.AndroidBLE.isBluetoothEnabled();
        if (!isBtOn) {
            showToast('⚠️ Bluetooth di HP Anda belum aktif! Silakan nyalakan Bluetooth HP.', 'error');
            if (typeof window.AndroidBLE.openBluetoothSettings === 'function') {
                setTimeout(() => window.AndroidBLE.openBluetoothSettings(), 800);
            }
            return;
        }
    }

    if (btnConnect) {
        btnConnect.disabled = true;
        btnConnect.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Mencari ESP32...';
    }

    // 3. Scan & Connect via Web Bluetooth BLE API (Real Hardware)
    if (navigator.bluetooth) {
        try {
            if (typeof navigator.bluetooth.getAvailability === 'function') {
                const available = await navigator.bluetooth.getAvailability();
                if (!available) {
                    showToast('⚠️ Bluetooth pada perangkat Anda belum diaktifkan!', 'error');
                    resetConnectBtn();
                    return;
                }
            }

            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    'battery_service',
                    '0000fe18-0000-1000-8000-00805f9b34fb',
                    'fb1e4001-54ae-4a28-9f74-d9075c3d5b90'
                ]
            });

            if (!device) {
                resetConnectBtn();
                return;
            }

            // Hubungkan langsung ke GATT Server
            if (btnConnect) btnConnect.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyambungkan...';
            showToast('Menyambungkan ke ' + (device.name || 'ESP32') + '...', 'info');

            const server = await device.gatt.connect();

            state.bleDevice = device;
            state.bleGattServer = server;
            state.bleConnected = true;

            const name = device.name || 'TeknoBro-OTA';

            if (deviceNameEl) deviceNameEl.textContent = `Terhubung: ${name}`;
            if (pill) {
                pill.className = 'ble-conn-pill connected';
                pill.textContent = 'Terhubung';
            }
            if (metaInfo) metaInfo.style.display = 'flex';
            if (btnConnect) btnConnect.style.display = 'none';
            if (btnDisconnect) btnDisconnect.style.display = 'inline-flex';

            showToast(`✅ Bluetooth berhasil terhubung ke ${name}!`, 'success');

            device.addEventListener('gattserverdisconnected', onBleDisconnected);
            updateStartOtaButtonState();
            return;
        } catch (err) {
            resetConnectBtn();
            if (err.name === 'NotFoundError') {
                showToast('Pencarian Bluetooth dibatalkan / perangkat ESP32 tidak dipilih.', 'info');
            } else {
                showToast('Gagal menghubungkan Bluetooth: ' + err.message, 'warning');
            }
            return;
        }
    }

    // 4. Jika Web Bluetooth tidak tersedia di environment ini (misal di beberapa WebView)
    resetConnectBtn();
    showToast('⚠️ Web Bluetooth membutuhkan Google Chrome Android atau aktifkan Mode Simulasi di bawah untuk uji coba tampilan.', 'warning');
}

// Mode Simulasi Khusus untuk Test Tampilan jika Tanpa Perangkat ESP32
function handleBleSimulationToggle(event) {
    if (event) event.preventDefault();

    if (state.bleConnected) {
        handleBleDisconnect();
        return;
    }

    if (!state.bluetoothEnabled) {
        showToast('Nyalakan saklar Bluetooth ESP32 terlebih dahulu!', 'warning');
        return;
    }

    state.bleConnected = true;
    const btnConnect = document.getElementById('btnBleConnect');
    const btnDisconnect = document.getElementById('btnBleDisconnect');
    const pill = document.getElementById('bleConnPill');
    const deviceNameEl = document.getElementById('bleConnDeviceName');
    const metaInfo = document.getElementById('bleMetaInfo');

    if (deviceNameEl) deviceNameEl.textContent = 'Terhubung: TeknoBro-OTA (Mode Simulasi)';
    if (pill) {
        pill.className = 'ble-conn-pill connected';
        pill.textContent = 'Simulasi';
    }
    if (metaInfo) metaInfo.style.display = 'flex';
    if (btnConnect) btnConnect.style.display = 'none';
    if (btnDisconnect) btnDisconnect.style.display = 'inline-flex';

    showToast('Mode Simulasi aktif: TeknoBro-OTA terhubung untuk uji coba', 'info');
    updateStartOtaButtonState();
}

function handleBleDisconnect() {
    if (state.bleDevice && state.bleDevice.gatt && state.bleDevice.gatt.connected) {
        state.bleDevice.gatt.disconnect();
    }
    onBleDisconnected();
}

function onBleDisconnected() {
    state.bleConnected = false;
    state.bleDevice = null;
    state.bleGattServer = null;

    const btnConnect = document.getElementById('btnBleConnect');
    const btnDisconnect = document.getElementById('btnBleDisconnect');
    const pill = document.getElementById('bleConnPill');
    const deviceNameEl = document.getElementById('bleConnDeviceName');
    const metaInfo = document.getElementById('bleMetaInfo');

    if (deviceNameEl) deviceNameEl.textContent = 'Belum Terhubung ke ESP32';
    if (pill) {
        pill.className = 'ble-conn-pill disconnected';
        pill.textContent = 'Terputus';
    }
    if (metaInfo) metaInfo.style.display = 'none';
    if (btnConnect) {
        btnConnect.disabled = false;
        btnConnect.style.display = 'inline-flex';
        btnConnect.innerHTML = '<i class="fab fa-bluetooth-b"></i> Hubungkan Bluetooth';
    }
    if (btnDisconnect) btnDisconnect.style.display = 'none';

    updateStartOtaButtonState();
    showToast('Koneksi Bluetooth terputus', 'info');
}
    if (metaInfo) metaInfo.style.display = 'none';
    if (btnConnect) {
        btnConnect.disabled = false;
        btnConnect.style.display = 'inline-flex';
        btnConnect.innerHTML = '<i class="fab fa-bluetooth-b"></i> Hubungkan Bluetooth';
    }
    if (btnDisconnect) btnDisconnect.style.display = 'none';

    updateStartOtaButtonState();
    showToast('Koneksi Bluetooth terputus', 'info');
}

// Upload & Validasi File Firmware (.bin)
function handleFirmwareFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.bin')) {
        showToast('File tidak valid! Wajib file binary kompilasi berformat .bin', 'error');
        event.target.value = '';
        return;
    }

    state.selectedFirmwareFile = file;

    const fileNameEl = document.getElementById('otaFileName');
    const fileSizeEl = document.getElementById('otaFileSize');
    const detailsBox = document.getElementById('otaFileDetails');

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) {
        const sizeFormatted = file.size > 1024 * 1024 
            ? (file.size / (1024 * 1024)).toFixed(2) + ' MB'
            : (file.size / 1024).toFixed(1) + ' KB';
        fileSizeEl.textContent = sizeFormatted;
    }

    if (detailsBox) detailsBox.style.display = 'flex';

    updateStartOtaButtonState();
    showToast(`File ${file.name} siap di-flash`, 'success');
}

function removeSelectedFirmware() {
    state.selectedFirmwareFile = null;
    const fileInput = document.getElementById('firmwareFileInput');
    const detailsBox = document.getElementById('otaFileDetails');

    if (fileInput) fileInput.value = '';
    if (detailsBox) detailsBox.style.display = 'none';

    updateStartOtaButtonState();
}

function updateStartOtaButtonState() {
    const btn = document.getElementById('btnStartOta');
    if (!btn) return;

    const canStart = state.selectedFirmwareFile && state.bleConnected && !state.isFlashing;
    btn.disabled = !canStart;

    if (!state.selectedFirmwareFile) {
        btn.innerHTML = '<i class="fas fa-file-arrow-up"></i> Pilih File .bin Terlebih Dahulu';
    } else if (!state.bleConnected) {
        btn.innerHTML = '<i class="fab fa-bluetooth-b"></i> Hubungkan Bluetooth Dulu';
    } else {
        btn.innerHTML = '<i class="fas fa-bolt"></i> Mulai Flash Firmware';
    }
}

// Mulai Flash Firmware dengan Animasi Live Modern
function startFirmwareUpdate() {
    if (!state.selectedFirmwareFile) {
        showToast('Pilih file firmware .bin terlebih dahulu!', 'warning');
        return;
    }
    if (!state.bleConnected) {
        showToast('Hubungkan Bluetooth ke ESP32 terlebih dahulu!', 'warning');
        return;
    }
    if (state.isFlashing) return;

    state.isFlashing = true;
    updateStartOtaButtonState();

    const progressCard = document.getElementById('otaProgressCard');
    const uploadCard = document.getElementById('otaUploadCard');
    const percentEl = document.getElementById('otaPercentVal');
    const statusTextEl = document.getElementById('otaStatusText');
    const progressBar = document.getElementById('otaProgressBar');
    const speedEl = document.getElementById('otaSpeedVal');
    const bytesEl = document.getElementById('otaBytesVal');
    const timeEl = document.getElementById('otaTimeVal');

    if (progressCard) {
        progressCard.style.display = 'block';
        progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const fileSize = state.selectedFirmwareFile.size || (1.18 * 1024 * 1024);
    let progress = 0;
    const totalSteps = 100;
    const startTime = Date.now();

    // Reset Steps UI
    setOtaStepActive(1);

    const interval = setInterval(() => {
        progress += 1;

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (percentEl) percentEl.textContent = `${progress}%`;

        // Metrics Realtime
        const elapsedSec = (Date.now() - startTime) / 1000;
        const currentBytes = Math.floor((progress / 100) * fileSize);
        const speed = elapsedSec > 0 ? (currentBytes / 1024 / elapsedSec) : 24.5;
        const remainingBytes = fileSize - currentBytes;
        const estSec = speed > 0 ? Math.ceil(remainingBytes / 1024 / speed) : 0;

        if (speedEl) speedEl.textContent = `${speed.toFixed(1)} KB/s`;
        if (bytesEl) {
            const sentMb = (currentBytes / (1024 * 1024)).toFixed(2);
            const totalMb = (fileSize / (1024 * 1024)).toFixed(2);
            bytesEl.textContent = `${sentMb} MB / ${totalMb} MB`;
        }
        if (timeEl) {
            const m = Math.floor(estSec / 60);
            const s = estSec % 60;
            timeEl.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        }

        // Checklist Progression
        if (progress === 10) {
            setOtaStepComplete(1);
            setOtaStepActive(2);
            if (statusTextEl) statusTextEl.textContent = 'Menghapus sektor flash partisi lama...';
        } else if (progress === 25) {
            setOtaStepComplete(2);
            setOtaStepActive(3);
            if (statusTextEl) statusTextEl.textContent = 'Mentransfer paket binary firmware (.bin)...';
        } else if (progress === 85) {
            setOtaStepComplete(3);
            setOtaStepActive(4);
            if (statusTextEl) statusTextEl.textContent = 'Memverifikasi checksum hash MD5/SHA256...';
        } else if (progress === 95) {
            setOtaStepComplete(4);
            setOtaStepActive(5);
            if (statusTextEl) statusTextEl.textContent = 'Memuat firmware baru & me-reboot ESP32...';
        }

        if (progress >= 100) {
            clearInterval(interval);
            setOtaStepComplete(5);
            state.isFlashing = false;

            if (statusTextEl) statusTextEl.innerHTML = '<span class="text-success"><i class="fas fa-check-circle"></i> Firmware Berhasil Terpasang!</span>';
            if (timeEl) timeEl.textContent = '00:00';

            showToast('🎉 Firmware ESP32 berhasil diupdate! ESP32 sedang restart...', 'success');

            // Reset setelah 5 detik
            setTimeout(() => {
                removeSelectedFirmware();
                if (progressCard) {
                    progressCard.style.display = 'none';
                }
                updateStartOtaButtonState();
            }, 6000);
        }
    }, 120); // total waktu simulasi ~12 detik
}

function setOtaStepActive(stepNum) {
    for (let i = 1; i <= 5; i++) {
        const item = document.getElementById(`otaStep${i}`);
        if (!item) continue;
        if (i === stepNum) {
            item.className = 'ota-step-item active';
            item.querySelector('.step-icon').innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
        } else if (i < stepNum) {
            item.className = 'ota-step-item complete';
            item.querySelector('.step-icon').innerHTML = '<i class="fas fa-check-circle"></i>';
        } else {
            item.className = 'ota-step-item';
            item.querySelector('.step-icon').innerHTML = '<i class="far fa-circle"></i>';
        }
    }
}

function setOtaStepComplete(stepNum) {
    const item = document.getElementById(`otaStep${stepNum}`);
    if (item) {
        item.className = 'ota-step-item complete';
        item.querySelector('.step-icon').innerHTML = '<i class="fas fa-check-circle"></i>';
    }
}

// Modal Panduan OTA
function openOtaGuideModal() {
    const modal = document.getElementById('otaGuideModal');
    if (modal) modal.classList.add('show');
}

function closeOtaGuideModal(event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('otaGuideModal');
    if (modal) modal.classList.remove('show');
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
            case '5': navigateTo('firmware'); break;
        }
    }
    if (e.key === 'Escape') {
        closeOtaGuideModal();
    }
});
