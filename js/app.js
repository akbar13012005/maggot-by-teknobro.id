document.addEventListener('DOMContentLoaded', () => {
    // 1. Inisialisasi Elemen Navigasi & Tab
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');

            // Aktifkan Nav Item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Tampilkan Tab Target
            tabContents.forEach(tab => {
                if (tab.id === targetTab) {
                    tab.classList.add('active');
                    tab.style.display = 'block';
                } else {
                    tab.classList.remove('active');
                    tab.style.display = 'none';
                }
            });
        });
    });

    // 2. Pengelolaan Status Koneksi ESP32 (Default: Offline)
    const statusBadge = document.getElementById('esp-status') || document.querySelector('.status-badge');
    let lastDataTime = 0;
    const TIMEOUT_THRESHOLD = 10000; // 10 detik tanpa data = Offline

    function setESPStatus(isOnline) {
        if (!statusBadge) return;
        if (isOnline) {
            statusBadge.textContent = 'Online';
            statusBadge.classList.remove('offline');
            statusBadge.classList.add('online');
        } else {
            statusBadge.textContent = 'Offline';
            statusBadge.classList.remove('online');
            statusBadge.classList.add('offline');
        }
    }

    // Setel default ke Offline saat aplikasi pertama kali dimuat
    setESPStatus(false);

    // Cek periodik untuk timeout koneksi ESP32
    setInterval(() => {
        if (Date.now() - lastDataTime > TIMEOUT_THRESHOLD && lastDataTime !== 0) {
            setESPStatus(false);
        }
    }, 3000);

    // 3. Fungsi Menerima Data dari ESP32 (Panggil fungsi ini saat WebSocket/MQTT menerima data)
    window.updateSensorData = function(data) {
        lastDataTime = Date.now();
        setESPStatus(true);

        // Update Nilai Suhu & Kelembapan
        if (data.temp !== undefined) {
            document.getElementById('temp-value').textContent = data.temp;
            updateGauge('temp-gauge', data.temp, 0, 50);
        }
        if (data.humidity !== undefined) {
            document.getElementById('humidity-value').textContent = data.humidity;
            updateGauge('humidity-gauge', data.humidity, 0, 100);
        }
    };

    // 4. Update Tampilan Gauge Arc/Melengkung
    function updateGauge(gaugeId, val, minVal, maxVal) {
        const gaugeFill = document.querySelector(`#${gaugeId} .gauge-fill`);
        if (!gaugeFill) return;
        
        let percentage = (val - minVal) / (maxVal - minVal);
        percentage = Math.min(Math.max(percentage, 0), 1);
        
        // Menghitung sudut rotasi arc (0 - 180 derajat)
        const rotation = percentage * 180;
        gaugeFill.style.transform = `rotate(${rotation}deg)`;
    }

    // 5. Interaksi Tombol Kontrol Relay
    const toggleButtons = document.querySelectorAll('.toggle-btn, .switch input');
    toggleButtons.forEach(btn => {
        btn.addEventListener('change', (e) => {
            const device = e.target.dataset.device || 'Relay';
            const state = e.target.checked ? 'ON' : 'OFF';
            console.log(`Mengirim perintah: ${device} -> ${state}`);
            // Tambahkan fungsi pengiriman perintah ke ESP32 (misal via WebSocket / HTTP Post) di sini
        });
    });

    // 6. Tombol Pemindaian Wi-Fi & Bluetooth
    const scanWifiBtn = document.getElementById('scan-wifi');
    const scanBleBtn = document.getElementById('scan-ble');

    if (scanWifiBtn) {
        scanWifiBtn.addEventListener('click', () => {
            alert('Mencari jaringan Wi-Fi...');
        });
    }
    if (scanBleBtn) {
        scanBleBtn.addEventListener('click', () => {
            alert('Mencari perangkat Bluetooth ESP32...');
        });
    }
});
