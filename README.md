# 🦟 TeknoBro - Monitoring & Kontrol Suhu Maggot

> Aplikasi IoT untuk monitoring dan kontrol suhu media maggot BSF (Black Soldier Fly) secara real-time menggunakan ESP32, SHT31-D, dan Firebase.

![TeknoBro](assets/logo-teknobro.jpg)

## 📋 Fitur

- 🌡️ **Monitoring Real-time** — Suhu media dan kelembaban
- 🎛️ **Kontrol Auto/Manual** — Mode otomatis (ESP32) dan manual (dari aplikasi)
- 🎯 **Target Suhu** — Atur suhu target media maggot
- ❄️ **Kontrol Pendingin** — Kipas + Peltier (1 GPIO)
- 🔥 **Kontrol Pemanas** — Lampu ayam
- 📊 **Grafik Historis** — Visualisasi data suhu dari waktu ke waktu
- 📥 **Export CSV** — Download data historis dalam format CSV
- 📶 **Multi-WiFi Auto-Connect** — Daftarkan hingga 3 profil WiFi di aplikasi; ESP32 otomatis connect & beralih ke jaringan terbaik (WiFiMulti)
- 📱 **Responsive** — Bisa diakses dari desktop dan mobile

## 🏗️ Struktur Proyek

```
teknobro-maggot-monitor/
├── index.html              # Halaman utama aplikasi
├── css/
│   └── style.css           # Styling aplikasi
├── js/
│   └── app.js              # Logika aplikasi + Firebase
├── assets/
│   └── logo-teknobro.jpg   # Logo TeknoBro
├── esp32/
│   └── maggot_monitor.ino  # Kode ESP32 (Arduino)
└── README.md               # Dokumentasi
```

## 🚀 Cara Memulai

### 1. Setup Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/)
2. Buat project baru
3. Aktifkan **Realtime Database**
4. Atur rules database:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
5. Salin konfigurasi Firebase ke `js/app.js`

### 2. Konfigurasi Web App

Edit file `js/app.js`, isi `FIREBASE_CONFIG`:

```javascript
const FIREBASE_CONFIG = {
    apiKey: "AIzaSy...",
    authDomain: "project-id.firebaseapp.com",
    databaseURL: "https://project-id-default-rtdb.firebaseio.com",
    projectId: "project-id",
    storageBucket: "project-id.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

### 3. Setup ESP32

1. Buka file `esp32/maggot_monitor.ino` di Arduino IDE
2. Install library yang dibutuhkan:
   - **Firebase ESP Client** by Mobizt
   - **Adafruit SHT31** by Adafruit
   - **Adafruit BusIO** by Adafruit
3. Isi konfigurasi WiFi dan Firebase
4. Upload ke ESP32

### 4. Wiring Hardware

| Komponen | Pin ESP32 |
|---|---|
| SHT31-D SDA | GPIO 21 |
| SHT31-D SCL | GPIO 22 |
| SHT31-D VCC | 3.3V |
| SHT31-D GND | GND |
| Relay Kipas+Peltier | GPIO 26 |
| Relay Lampu Pemanas | GPIO 27 |

### 5. Deploy Web App

**Opsi A: Buka langsung**
- Double-click `index.html` untuk membuka di browser (mode demo)

**Opsi B: Firebase Hosting**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## 📊 Struktur Database Firebase

```json
{
  "sensor": {
    "suhu_media": 30.4,
    "kelembaban": 69.3,
    "timestamp": 1699999999
  },
  "control": {
    "mode": "auto",
    "target_suhu": 30.0,
    "kipas_peltier": false,
    "lampu_pemanas": false
  },
  "status": {
    "online": true,
    "last_seen": 1699999999,
    "wifi_rssi": -45,
    "uptime": 3600
  },
  "history": {
    "-Labc123": {
      "suhu_media": 30.4,
      "kelembaban": 69.3,
      "target": 30.0,
      "mode": "auto",
      "timestamp": 1699999999
    }
  }
}
```

## ⌨️ Keyboard Shortcut

| Shortcut | Fungsi |
|---|---|
| `Alt + 1` | Halaman Monitoring |
| `Alt + 2` | Halaman Kontrol |
| `Alt + 3` | Halaman Riwayat |
| `Alt + 4` | Halaman Jaringan WiFi |

## 📄 Lisensi

© 2024 TeknoBro. All rights reserved.
