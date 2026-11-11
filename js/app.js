/* TeknoBro IoT Dashboard — navigation, Firebase RTDB, freshness and controls */
(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBpcvH685A8w3iMnRtN6k0eqHcmZDrpQDE",
    authDomain: "maggot-iot-5e285.firebaseapp.com",
    databaseURL: "https://maggot-iot-5e285-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "maggot-iot-5e285",
    storageBucket: "maggot-iot-5e285.firebasestorage.app",
    messagingSenderId: "553245663212",
    appId: "1:553245663212:web:76046f6b2ee42eb0d3eac9"
  };

  const DATA_FRESH_MS = 20000; // Fresh: dua interval kirim sensor.
  const DATA_TIMEOUT_MS = 45000; // Offline: lebih dari 45 detik tanpa timestamp baru.
  const $ = (id) => document.getElementById(id);
  let db = null;
  let lastSensorTimestamp = 0;
  let latestSensor = {};
  let latestControl = { mode: 'auto', target_suhu: 30, kipas_peltier: false, lampu_pemanas: false };
  let historyRows = [];
  let trendChart = null;
  let historyChart = null;
  let pwaPrompt = null;

  function toast(message, type = 'info') {
    const host = $('toast-container');
    if (!host) { console.info(message); return; }

    const variants = {
      success: { icon: 'fa-circle-check', label: 'Berhasil' },
      error: { icon: 'fa-circle-xmark', label: 'Gagal' },
      warning: { icon: 'fa-triangle-exclamation', label: 'Perhatian' },
      info: { icon: 'fa-circle-info', label: 'Informasi' }
    };
    const variant = variants[type] || variants.info;
    const item = document.createElement('div');
    item.className = 'tb-toast ' + type;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    item.innerHTML = '<i class="fas ' + variant.icon + '" aria-hidden="true"></i><span class="tb-toast-message"></span>';
    item.querySelector('.tb-toast-message').textContent = message;
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));

    const duration = Math.min(6000, Math.max(2800, message.length * 55));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 220);
    }, duration);
  }

  function navigateTo(page, event) {
    if (event) event.preventDefault();
    const target = $('page-' + page);
    if (!target) return;
    document.querySelectorAll('.page').forEach(el => {
      const active = el === target;
      el.classList.toggle('active', active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    document.querySelectorAll('.nav-item').forEach(el => {
      const active = el.dataset.page === page;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    if (page === 'riwayat') loadHistory();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.navigateTo = navigateTo;

  function closeSidebar() {
    $('sidebar')?.classList.remove('open');
    $('sidebarOverlay')?.classList.remove('show');
  }
  window.toggleSidebar = () => {
    $('sidebar')?.classList.toggle('open');
    $('sidebarOverlay')?.classList.toggle('show');
  };
  $('sidebarOverlay')?.addEventListener('click', closeSidebar);

  function setDeviceStatus(state, detail) {
    const badge = $('liveBadge');
    const text = $('badgeText');
    const states = {
      online: { label: 'PERANGKAT ONLINE', cls: 'online' },
      stale: { label: 'DATA TERLAMBAT', cls: 'stale' },
      offline: { label: 'PERANGKAT OFFLINE', cls: 'offline' },
      waiting: { label: 'MENUNGGU DATA', cls: 'waiting' }
    };
    const current = states[state] || states.waiting;
    if (badge) {
      badge.classList.remove('online', 'offline', 'stale', 'waiting');
      badge.classList.add(current.cls);
      badge.setAttribute('title', detail || current.label);
      badge.setAttribute('aria-label', detail || current.label);
    }
    if (text) text.textContent = current.label;
    const summary = $('summary-status');
    if (summary) {
      const dotClass = state === 'online' ? 'online' : state === 'offline' ? 'offline' : 'standby';
      summary.innerHTML = '<span class="status-dot ' + dotClass + '"></span><span>' + current.label + '</span>';
    }
    ['mobile-status-dot'].forEach(id => {
      const dot = $(id);
      if (dot) {
        dot.classList.remove('online', 'offline', 'standby');
        dot.classList.add(state === 'online' ? 'online' : state === 'offline' ? 'offline' : 'standby');
      }
    });
  }

  function evaluateFreshness() {
    if (!lastSensorTimestamp) {
      setDeviceStatus('waiting', 'Belum menerima timestamp sensor dari ESP32');
      return;
    }
    const age = Date.now() - lastSensorTimestamp * 1000;
    if (age < -60000) {
      setDeviceStatus('waiting', 'Waktu perangkat belum tersinkronisasi (NTP)');
    } else if (age <= DATA_FRESH_MS) {
      setDeviceStatus('online', 'Data sensor diterima ' + Math.max(0, Math.round(age / 1000)) + ' detik lalu');
    } else if (age <= DATA_TIMEOUT_MS) {
      setDeviceStatus('stale', 'Data sensor terlambat ' + Math.round(age / 1000) + ' detik');
    } else {
      setDeviceStatus('offline', 'Tidak ada data sensor baru selama ' + Math.round(age / 1000) + ' detik');
    }
  }

  function updateGauge(value) {
    const path = $('gaugeFill');
    const output = $('gaugeTemp');
    if (output) output.textContent = Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '--.-';
    if (!path) return;
    const min = 20, max = 45;
    const v = Math.min(max, Math.max(min, Number(value)));
    const ratio = Number.isFinite(v) ? (v - min) / (max - min) : 0;
    let length = 267;
    try { length = path.getTotalLength(); } catch (_) {}
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length * (1 - ratio));
  }

  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }

  function updateSensor(sensor) {
    latestSensor = sensor || {};
    const temp = Number(sensor.suhu_media);
    const humidity = Number(sensor.kelembaban);
    const ts = Number(sensor.timestamp);
    if (Number.isFinite(temp)) {
      setText('val-suhu-media', temp.toFixed(1) + '°C');
      updateGauge(temp);
      const status = $('status-suhu-media');
      if (status) status.textContent = temp < 28 ? 'Di bawah rentang ideal' : temp > 35 ? 'Di atas rentang ideal' : 'Dalam rentang ideal';
    }
    if (Number.isFinite(humidity)) {
      setText('val-kelembaban', humidity.toFixed(1) + '%');
      const status = $('status-kelembaban');
      if (status) status.textContent = 'Kelembapan relatif';
    }
    if (Number.isFinite(ts) && ts > 1600000000) lastSensorTimestamp = ts;
    evaluateFreshness();
    addTrendPoint(ts, temp);
  }

  function addTrendPoint(timestamp, temperature) {
    if (!Number.isFinite(temperature) || !Number.isFinite(timestamp) || timestamp < 1600000000) return;
    const point = { x: timestamp * 1000, y: temperature };
    if (!trendChart && window.Chart && $('trendChart')) {
      trendChart = new Chart($('trendChart'), {
        type: 'line',
        data: { datasets: [{ label: 'Suhu media (°C)', data: [point], borderColor: '#00b4d8', backgroundColor: 'rgba(0,180,216,.12)', fill: true, tension: .35, pointRadius: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
          scales: { x: { type: 'time', time: { displayFormats: { minute: 'HH:mm' } }, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#7b89a8' } },
                    y: { suggestedMin: 20, suggestedMax: 45, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#7b89a8' } } },
          plugins: { legend: { labels: { color: '#e8ecf4' } } } }
      });
      return;
    }
    if (trendChart) {
      const data = trendChart.data.datasets[0].data;
      if (!data.length || data[data.length - 1].x !== point.x) data.push(point);
      const cutoff = Date.now() - 60 * 60 * 1000;
      trendChart.data.datasets[0].data = data.filter(p => p.x >= cutoff);
      trendChart.update('none');
    }
  }

  function updateControl(control) {
    latestControl = { ...latestControl, ...(control || {}) };
    const mode = latestControl.mode === 'manual' ? 'manual' : 'auto';
    const target = Number(latestControl.target_suhu);
    setText('summary-mode', mode === 'auto' ? 'Otomatis' : 'Manual');
    if (Number.isFinite(target)) {
      setText('summary-target', target.toFixed(1) + '°C');
      setText('val-target', target.toFixed(1) + '°C');
      if ($('targetInput')) $('targetInput').value = target.toFixed(1);
      if ($('targetSlider')) $('targetSlider').value = target;
    }
    $('modeAutoBtn')?.classList.toggle('active', mode === 'auto');
    $('modeManualBtn')?.classList.toggle('active', mode === 'manual');
    const manual = mode === 'manual';
    ['toggle-kipas', 'toggle-lampu'].forEach(id => { if ($(id)) $(id).disabled = !manual; });
    if ($('manualHint')) $('manualHint').textContent = manual ? 'Mode manual aktif — kontrol perangkat tersedia.' : 'Aktifkan mode Manual untuk mengontrol perangkat secara langsung.';
    updateDevice('kipas_peltier', !!latestControl.kipas_peltier);
    updateDevice('lampu_pemanas', !!latestControl.lampu_pemanas);
  }

  function updateDevice(key, on) {
    const suffix = key === 'kipas_peltier' ? 'kipas' : 'lampu';
    const toggle = $('toggle-' + suffix);
    if (toggle) toggle.checked = on;
    setText('device-status-' + suffix, on ? 'ON' : 'OFF');
    $('card-' + suffix)?.classList.toggle('device-on', on);
    $('ring-' + suffix)?.classList.toggle('active', on);
  }

  async function writeControl(key, value) {
    if (!db) { toast('Firebase belum terhubung.', 'error'); return false; }
    try { await db.ref('/control/' + key).set(value); return true; }
    catch (err) { toast('Gagal menyimpan kontrol: ' + err.message, 'error'); return false; }
  }
  window.setMode = async mode => {
    if (!['auto', 'manual'].includes(mode)) return;
    if (await writeControl('mode', mode)) toast('Mode ' + (mode === 'auto' ? 'otomatis' : 'manual') + ' berhasil diaktifkan.', 'success');
  };
  window.adjustTarget = delta => {
    const current = Number($('targetInput')?.value ?? latestControl.target_suhu);
    const next = Math.min(45, Math.max(20, current + Number(delta)));
    if ($('targetInput')) $('targetInput').value = next.toFixed(1);
    if ($('targetSlider')) $('targetSlider').value = next;
    window.setTarget(next);
  };
  window.setTarget = value => {
    const next = Math.min(45, Math.max(20, Number(value)));
    if (!Number.isFinite(next)) return;
    if ($('targetInput')) $('targetInput').value = next.toFixed(1);
    if ($('targetSlider')) $('targetSlider').value = next;
    clearTimeout(window.__targetWriteTimer);
    window.__targetWriteTimer = setTimeout(() => writeControl('target_suhu', next), 350);
  };
  window.toggleDevice = async (key, checked) => {
    if (latestControl.mode !== 'manual') { toast('Ubah ke mode Manual terlebih dahulu.', 'error'); updateDevice(key, !!latestControl[key]); return; }
    if (await writeControl(key, !!checked)) toast((key === 'kipas_peltier' ? 'Pendingin ' : 'Pemanas ') + (checked ? 'ON' : 'OFF'));
  };

  function renderHistory() {
    const from = $('dateFrom')?.value ? new Date($('dateFrom').value + 'T00:00:00').getTime() / 1000 : 0;
    const to = $('dateTo')?.value ? new Date($('dateTo').value + 'T23:59:59').getTime() / 1000 : Infinity;
    const limit = Number($('dataLimit')?.value || 100);
    let rows = historyRows.filter(r => r.timestamp >= from && r.timestamp <= to).sort((a,b) => b.timestamp - a.timestamp);
    if (limit > 0) rows = rows.slice(0, limit);
    setText('dataCount', rows.length + ' data');
    const body = $('historyTableBody');
    if (body) {
      body.replaceChildren();
      if (!rows.length) {
        const tr = document.createElement('tr'); const td = document.createElement('td');
        td.colSpan = 6; td.className = 'empty-state'; td.textContent = 'Belum ada data riwayat'; tr.appendChild(td); body.appendChild(tr);
      } else rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        [String(i + 1), new Date(r.timestamp * 1000).toLocaleString('id-ID'), Number(r.suhu_media).toFixed(1) + ' °C',
         Number(r.kelembaban).toFixed(1) + ' %', Number(r.target).toFixed(1) + ' °C', r.mode || '-'].forEach(v => {
          const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }
    if (window.Chart && $('historyChart')) {
      const chartRows = [...rows].reverse();
      const labels = chartRows.map(r => new Date(r.timestamp * 1000));
      const data = chartRows.map(r => Number(r.suhu_media));
      if (!historyChart) historyChart = new Chart($('historyChart'), {
        type: 'line', data: { labels, datasets: [{ label: 'Suhu media (°C)', data, borderColor: '#00b4d8', backgroundColor: 'rgba(0,180,216,.12)', fill: true, tension: .3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8ecf4' } } }, scales: { x: { ticks: { color: '#7b89a8' } }, y: { ticks: { color: '#7b89a8' } } } }
      });
      else { historyChart.data.labels = labels; historyChart.data.datasets[0].data = data; historyChart.update(); }
    }
  }
  window.loadHistory = renderHistory;
  window.exportCSV = () => {
    if (!historyRows.length) { toast('Belum ada data riwayat untuk diekspor.', 'error'); return; }
    const rows = [['Waktu','Suhu Media (°C)','Kelembaban (%)','Target (°C)','Mode','Kipas/Peltier','Pemanas'],
      ...historyRows.slice().sort((a,b) => a.timestamp-b.timestamp).map(r => [new Date(r.timestamp*1000).toLocaleString('id-ID'),r.suhu_media,r.kelembaban,r.target,r.mode,r.kipas,r.pemanas])];
    const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8;'}));
    const a = document.createElement('a'); a.href = url; a.download = 'teknobro-riwayat-maggot.csv'; a.click(); URL.revokeObjectURL(url);
  };

  window.saveWiFiConfig = async () => {
    if (!db) { toast('Firebase belum terhubung.', 'error'); return; }
    const config = { updated_at: Math.floor(Date.now()/1000) };
    for (let i=1;i<=3;i++) {
      config['slot'+i] = { ssid: $('wifi-ssid-'+i)?.value.trim() || '', pass: $('wifi-pass-'+i)?.value || '' };
    }
    try { await db.ref('/wifi_config').set(config); toast('Konfigurasi WiFi dikirim. ESP32 akan mengambilnya saat polling berikutnya.'); }
    catch (err) { toast('Gagal menyimpan WiFi: ' + err.message, 'error'); }
  };
  window.togglePasswordVisibility = (id, button) => {
    const input = $(id); if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const icon = button?.querySelector('i');
    if (icon) { icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); }
  };

  window.openOtaGuideModal = () => $('otaGuideModal')?.classList.add('show');
  window.closeOtaGuideModal = event => { if (event) event.stopPropagation(); $('otaGuideModal')?.classList.remove('show'); };
  window.handleFirmwareFileSelect = event => {
    const file = event?.target?.files?.[0]; if (!file) return;
    setText('otaFileName', file.name); setText('otaFileSize', (file.size/1024).toFixed(1) + ' KB');
    $('otaFileDetails')?.classList.add('show'); if ($('btnStartOta')) $('btnStartOta').disabled = true;
    setText('otaFileStatus', 'File dipilih. Proses OTA BLE memerlukan koneksi BLE native yang belum diimplementasikan pada dashboard web.');
    toast('File firmware dipilih. Pengiriman OTA belum diaktifkan pada versi web ini.', 'info');
  };
  window.removeSelectedFirmware = () => {
    if ($('firmwareFileInput')) $('firmwareFileInput').value = '';
    $('otaFileDetails')?.classList.remove('show');
  };
  window.startFirmwareUpdate = () => toast('OTA belum dijalankan: dashboard web belum memiliki protokol BLE OTA yang terhubung ke firmware.', 'error');
  window.toggleEsp32Bluetooth = () => toast('Kontrol BLE belum terhubung ke layanan BLE pada firmware.', 'info');
  window.handleBleConnect = () => toast('Koneksi BLE belum diimplementasikan pada versi web ini.', 'info');
  window.handleBleDisconnect = () => toast('Tidak ada sesi BLE web yang aktif.', 'info');
  window.handleBleSimulationToggle = () => toast('Mode simulasi BLE dinonaktifkan agar status perangkat tidak menyesatkan.', 'info');

  window.triggerPWAInstall = async () => {
    if (!pwaPrompt) { toast('Instalasi tersedia melalui menu browser jika aplikasi memenuhi syarat PWA.'); return; }
    pwaPrompt.prompt(); await pwaPrompt.userChoice; pwaPrompt = null;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); pwaPrompt = event;
    if ($('installContainer')) $('installContainer').style.display = 'block';
    if ($('mobileInstallBtn')) $('mobileInstallBtn').style.display = 'flex';
  });

  function connectFirebase() {
    if (!window.firebase || !window.firebase.database || !window.firebase.auth) {
      if ($('demoBanner')) $('demoBanner').style.display = 'flex';
      setDeviceStatus('waiting', 'Firebase SDK tidak tersedia');
      toast('Firebase SDK tidak lengkap. Periksa koneksi internet dan script Firebase.', 'error');
      return;
    }

    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
      const auth = app.auth();
      db = app.database();

      // Dashboard memakai Anonymous Authentication yang sama-sama diaktifkan
      // untuk ESP32. Listener RTDB baru dipasang setelah login berhasil.
      auth.signInAnonymously().then(() => {
        if ($('demoBanner')) $('demoBanner').style.display = 'none';
        console.info('[TeknoBro] Firebase anonymous auth berhasil:', auth.currentUser?.uid);

        db.ref('.info/connected').on('value', snap => {
          if (!snap.val()) {
            setDeviceStatus(lastSensorTimestamp ? 'stale' : 'waiting', 'Koneksi dashboard ke Firebase terputus');
          }
        });

        db.ref('/sensor').on('value', snap => {
          const value = snap.val();
          if (value) updateSensor(value);
          else {
            lastSensorTimestamp = 0;
            setDeviceStatus('waiting', 'Belum ada data sensor pada Firebase');
          }
        }, err => {
          setDeviceStatus('waiting', 'Firebase sensor: ' + err.message);
          toast('Tidak dapat membaca sensor Firebase: ' + err.message, 'error');
        });

        db.ref('/control').on('value', snap => {
          if (snap.val()) updateControl(snap.val());
        }, err => toast('Tidak dapat membaca kontrol: ' + err.message, 'error'));

        db.ref('/status').on('value', snap => {
          const status = snap.val() || {};
          setText('wifi-current-ssid', status.wifi_ssid || '—');
          setText('wifi-current-rssi', Number.isFinite(Number(status.wifi_rssi)) ? status.wifi_rssi + ' dBm' : '—');
          setText('wifi-current-ip', status.ip || '—');
        }, err => console.warn('Status Firebase:', err));

        db.ref('/history').limitToLast(1000).on('value', snap => {
          const raw = snap.val() || {};
          historyRows = Object.values(raw)
            .filter(row => row && Number(row.timestamp) > 0)
            .map(row => ({ ...row, timestamp: Number(row.timestamp) }));
          renderHistory();
        }, err => toast('Tidak dapat membaca riwayat: ' + err.message, 'error'));
      }).catch(err => {
        db = null;
        setDeviceStatus('waiting', 'Autentikasi Firebase gagal');
        toast('Login Firebase gagal: ' + (err.code || err.message), 'error');
        console.error('[TeknoBro] Firebase auth:', err);
      });
    } catch (err) {
      db = null;
      setDeviceStatus('waiting', 'Firebase gagal diinisialisasi');
      toast('Firebase gagal diinisialisasi: ' + err.message, 'error');
      console.error('[TeknoBro] Firebase init:', err);
    }
  }

  document.addEventListener('keydown', event => {
    if (!event.altKey) return;
    const pages = {'1':'monitoring','2':'kontrol','3':'riwayat','4':'wifi','5':'firmware'};
    if (pages[event.key]) { event.preventDefault(); navigateTo(pages[event.key]); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', event => navigateTo(item.dataset.page, event));
    });
    setDeviceStatus('waiting', 'Menunggu timestamp sensor pertama');
    updateGauge(NaN);
    connectFirebase();
    setInterval(evaluateFreshness, 3000);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
    }
  });
})();
