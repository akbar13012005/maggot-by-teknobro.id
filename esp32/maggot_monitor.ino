/*
 * ============================================
 * TeknoBro - Monitoring & Kontrol Suhu Maggot
 * ESP32 + SHT31-D + Firebase
 * ============================================
 * 
 * Hardware:
 *   - ESP32 DevKit v1
 *   - SHT31-D Sensor (I2C: SDA=21, SCL=22)
 *   - Relay Kipas + Peltier (GPIO 26)
 *   - Relay Lampu Pemanas (GPIO 27)
 * 
 * Library yang dibutuhkan (install via Arduino Library Manager):
 *   1. Firebase ESP Client by Mobizt
 *   2. Adafruit SHT31 by Adafruit
 *   3. Adafruit BusIO by Adafruit
 *   4. ArduinoJson by Benoit Blanchon
 *   5. NTPClient by Fabrice Weinberg
 * 
 * Board: ESP32 Dev Module
 * Partition: Default 4MB with spiffs
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <Preferences.h>
#include <Firebase_ESP_Client.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <time.h>
#include "secrets.h"  // File lokal; jangan commit kredensial ke GitHub

// ==========================================
// ========== KONFIGURASI ==================
// ==========================================

// Default 3 Profil WiFi (akan disimpan di flash memory NVS ESP32)
// Pengguna juga bisa mengganti ini kapan saja lewat Web App!
// Nilai WiFi dan Firebase diambil dari secrets.h lokal (tidak masuk Git).
#ifndef DEFAULT_SSID_1
#define DEFAULT_SSID_1 ""
#endif
#ifndef DEFAULT_PASS_1
#define DEFAULT_PASS_1 ""
#endif
#ifndef DEFAULT_SSID_2
#define DEFAULT_SSID_2 ""
#endif
#ifndef DEFAULT_PASS_2
#define DEFAULT_PASS_2 ""
#endif
#ifndef DEFAULT_SSID_3
#define DEFAULT_SSID_3 ""
#endif
#ifndef DEFAULT_PASS_3
#define DEFAULT_PASS_3 ""
#endif

#ifndef FIREBASE_API_KEY
#error "Isi FIREBASE_API_KEY pada esp32/secrets.h"
#endif
#ifndef FIREBASE_DATABASE_URL
#error "Isi FIREBASE_DATABASE_URL pada esp32/secrets.h"
#endif

// Pin GPIO
#define PIN_KIPAS_PELTIER   26    // Relay Kipas + Peltier (1 GPIO)
#define PIN_LAMPU_PEMANAS   27    // Relay Lampu Pemanas (Lampu Ayam)
#define PIN_SDA             21    // I2C SDA untuk SHT31-D
#define PIN_SCL             22    // I2C SCL untuk SHT31-D

// Relay active LOW (kebanyakan relay module aktif LOW)
#define RELAY_ON    LOW
#define RELAY_OFF   HIGH

// Interval
#define SENSOR_READ_INTERVAL    5000    // Baca sensor setiap 5 detik
#define FIREBASE_SEND_INTERVAL  10000   // Kirim data ke Firebase setiap 10 detik
#define HISTORY_SAVE_INTERVAL   300000  // Simpan history setiap 5 menit
#define CONTROL_CHECK_INTERVAL  2000    // Cek kontrol dari Firebase setiap 2 detik
#define STATUS_UPDATE_INTERVAL  30000   // Update metadata status setiap 30 detik
#define WIFI_RECONNECT_INTERVAL 15000   // Jeda antar percobaan reconnect WiFi
#define VALID_EPOCH_MIN         1700000000UL

// Batas suhu untuk mode auto (hysteresis)
#define HYSTERESIS  1.0   // ±1°C dari target

// NTP
#define NTP_SERVER  "pool.ntp.org"
#define GMT_OFFSET  25200   // GMT+7 (WIB) = 7 * 3600

// ==========================================
// ========== OBJEK GLOBAL =================
// ==========================================

Adafruit_SHT31 sht31 = Adafruit_SHT31();
WiFiMulti wifiMulti;
Preferences prefs;

FirebaseData fbData;
FirebaseData fbStream;
FirebaseAuth auth;
FirebaseConfig config;

// Profil WiFi yang tersimpan
String wifi_ssid_1, wifi_pass_1;
String wifi_ssid_2, wifi_pass_2;
String wifi_ssid_3, wifi_pass_3;
unsigned long lastWiFiUpdate = 0;
unsigned long lastWiFiReconnectAttempt = 0;

// Variabel sensor
float suhuMedia = 0.0;
float kelembaban = 0.0;

// Variabel kontrol
String mode_operasi = "auto";
float target_suhu = 30.0;
bool kipas_peltier = false;
bool lampu_pemanas = false;

// Timing
unsigned long lastSensorRead = 0;
unsigned long lastFirebaseSend = 0;
unsigned long lastHistorySave = 0;
unsigned long lastControlCheck = 0;
unsigned long lastStatusUpdate = 0;
unsigned long bootTime = 0;

// Flag
bool firebaseReady = false;
bool sensorOK = false;

// ==========================================
// ========== SETUP ========================
// ==========================================

void setup() {
    Serial.begin(115200);
    Serial.println();
    Serial.println("====================================");
    Serial.println("  TeknoBro - Monitoring Suhu Maggot");
    Serial.println("  ESP32 + SHT31-D + Firebase");
    Serial.println("====================================");
    Serial.println();

    // Setup pin relay
    pinMode(PIN_KIPAS_PELTIER, OUTPUT);
    pinMode(PIN_LAMPU_PEMANAS, OUTPUT);
    digitalWrite(PIN_KIPAS_PELTIER, RELAY_OFF);
    digitalWrite(PIN_LAMPU_PEMANAS, RELAY_OFF);

    // Setup I2C dan sensor SHT31-D
    Wire.begin(PIN_SDA, PIN_SCL);
    if (sht31.begin(0x44)) {
        Serial.println("✅ Sensor SHT31-D terdeteksi!");
        sensorOK = true;
    } else {
        Serial.println("❌ Sensor SHT31-D TIDAK terdeteksi!");
        Serial.println("   Periksa wiring I2C (SDA=21, SCL=22)");
        sensorOK = false;
    }

    // Inisialisasi profil WiFi & Koneksi
    initWiFiProfiles();
    connectWiFi();

    // Setup NTP
    configTime(GMT_OFFSET, 0, NTP_SERVER);
    Serial.println("⏰ Sinkronisasi waktu NTP...");

    // Setup Firebase
    setupFirebase();

    bootTime = millis();
    Serial.println();
    Serial.println("🚀 Sistem siap!");
    Serial.println();
}

// ==========================================
// ========== LOOP =========================
// ==========================================

void loop() {
    unsigned long now = millis();

    // 1. Baca sensor
    if (now - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = now;
        bacaSensor();
    }

    // 2. Cek kontrol dari Firebase
    if (now - lastControlCheck >= CONTROL_CHECK_INTERVAL) {
        lastControlCheck = now;
        cekKontrolFirebase();
    }

    // 3. Jalankan logika kontrol
    eksekusiKontrol();

    // 4. Kirim data sensor ke Firebase
    if (firebaseReady && now - lastFirebaseSend >= FIREBASE_SEND_INTERVAL) {
        lastFirebaseSend = now;
        kirimDataSensor();
    }

    // 5. Simpan history
    if (firebaseReady && now - lastHistorySave >= HISTORY_SAVE_INTERVAL) {
        lastHistorySave = now;
        simpanHistory();
    }

    // 6. Update status online
    if (firebaseReady && now - lastStatusUpdate >= STATUS_UPDATE_INTERVAL) {
        lastStatusUpdate = now;
        updateStatus();
    }

    // Reconnect WiFi jika terputus
    if (WiFi.status() != WL_CONNECTED && now - lastWiFiReconnectAttempt >= WIFI_RECONNECT_INTERVAL) {
        lastWiFiReconnectAttempt = now;
        Serial.println("⚠️ WiFi terputus! Mencoba reconnect...");
        connectWiFi();
    }
}

// ==========================================
// ========== WIFI =========================
// ==========================================

void initWiFiProfiles() {
    prefs.begin("wifi_cfg", false);
    wifi_ssid_1 = prefs.getString("ssid1", DEFAULT_SSID_1);
    wifi_pass_1 = prefs.getString("pass1", DEFAULT_PASS_1);
    wifi_ssid_2 = prefs.getString("ssid2", DEFAULT_SSID_2);
    wifi_pass_2 = prefs.getString("pass2", DEFAULT_PASS_2);
    wifi_ssid_3 = prefs.getString("ssid3", DEFAULT_SSID_3);
    wifi_pass_3 = prefs.getString("pass3", DEFAULT_PASS_3);
    prefs.end();

    // Daftarkan ke WiFiMulti untuk auto-connect
    if (wifi_ssid_1.length() > 0) wifiMulti.addAP(wifi_ssid_1.c_str(), wifi_pass_1.c_str());
    if (wifi_ssid_2.length() > 0) wifiMulti.addAP(wifi_ssid_2.c_str(), wifi_pass_2.c_str());
    if (wifi_ssid_3.length() > 0) wifiMulti.addAP(wifi_ssid_3.c_str(), wifi_pass_3.c_str());

    Serial.println("📋 Profil WiFi Terdaftar (Auto-Connect):");
    Serial.printf("   1. %s\n", wifi_ssid_1.c_str());
    Serial.printf("   2. %s\n", wifi_ssid_2.c_str());
    Serial.printf("   3. %s\n", wifi_ssid_3.c_str());
}

void connectWiFi() {
    Serial.println("📶 Memindai & menghubungkan ke WiFi terbaik (WiFiMulti)...");
    WiFi.mode(WIFI_STA);

    int attempts = 0;
    while (wifiMulti.run() != WL_CONNECTED && attempts < 10) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.print("✅ WiFi Terhubung: ");
        Serial.println(WiFi.SSID());
        Serial.print("   IP ESP32      : ");
        Serial.println(WiFi.localIP());
        Serial.print("   Sinyal (RSSI) : ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    } else {
        Serial.println();
        Serial.println("⚠️ Belum terhubung ke WiFi terdaftar. Sistem akan terus mencoba di background.");
    }
}

// ==========================================
// ========== FIREBASE =====================
// ==========================================

void setupFirebase() {
    Serial.println("🔥 Mengkonfigurasi Firebase Realtime Database...");

    config.api_key = FIREBASE_API_KEY;
    config.database_url = FIREBASE_DATABASE_URL;

    // Firebase Authentication > Sign-in method > Anonymous harus diaktifkan.
    // Untuk produksi, batasi Rules per path dan pertimbangkan autentikasi perangkat khusus.
    if (!Firebase.signUp(&config, &auth, "", "")) {
        Serial.print("❌ Anonymous sign-up gagal: ");
        Serial.println(config.signer.signupError.message.c_str());
        firebaseReady = false;
        return;
    }

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    firebaseReady = false; // Token dibuat asynchronous; loop() akan menunggu Firebase.ready().
    Serial.println("⏳ Menunggu token autentikasi Firebase...");
}

// ==========================================
// ========== SENSOR =======================
// ==========================================

void bacaSensor() {
    if (!sensorOK) {
        // Coba inisialisasi ulang sensor
        if (sht31.begin(0x44)) {
            sensorOK = true;
            Serial.println("✅ Sensor SHT31-D berhasil di-reinisialisasi");
        }
        return;
    }

    float t = sht31.readTemperature();
    float h = sht31.readHumidity();

    if (!isnan(t) && !isnan(h)) {
        suhuMedia = t;
        kelembaban = h;

        Serial.printf("🌡️ Suhu: %.1f°C | 💧 Kelembaban: %.1f%% | 🎯 Target: %.1f°C | 📋 Mode: %s\n",
                       suhuMedia, kelembaban, target_suhu, mode_operasi.c_str());
    } else {
        Serial.println("⚠️ Gagal membaca sensor SHT31-D!");
        sensorOK = false;
    }
}

// ==========================================
// ========== KONTROL ======================
// ==========================================

void cekKontrolFirebase() {
    if (!firebaseReady || !Firebase.ready()) return;

    // Baca mode
    if (Firebase.RTDB.getString(&fbData, "/control/mode")) {
        mode_operasi = fbData.stringData();
    }

    // Baca target suhu
    if (Firebase.RTDB.getFloat(&fbData, "/control/target_suhu")) {
        target_suhu = fbData.floatData();
    }

    // Baca status manual kontrol
    if (mode_operasi == "manual") {
        if (Firebase.RTDB.getBool(&fbData, "/control/kipas_peltier")) {
            kipas_peltier = fbData.boolData();
        }
        if (Firebase.RTDB.getBool(&fbData, "/control/lampu_pemanas")) {
            lampu_pemanas = fbData.boolData();
        }
    }

    // Cek apakah ada update konfigurasi WiFi dari Web App
    cekWiFiConfigFirebase();
}

void cekWiFiConfigFirebase() {
    if (Firebase.RTDB.getJSON(&fbData, "/wifi_config")) {
        FirebaseJson &json = fbData.jsonObject();
        FirebaseJsonData jsonData;

        json.get(jsonData, "updated_at");
        if (jsonData.success && (unsigned long)jsonData.intValue > lastWiFiUpdate) {
            lastWiFiUpdate = jsonData.intValue;

            prefs.begin("wifi_cfg", false);

            json.get(jsonData, "slot1/ssid");
            if (jsonData.success) prefs.putString("ssid1", jsonData.stringValue);
            json.get(jsonData, "slot1/pass");
            if (jsonData.success) prefs.putString("pass1", jsonData.stringValue);

            json.get(jsonData, "slot2/ssid");
            if (jsonData.success) prefs.putString("ssid2", jsonData.stringValue);
            json.get(jsonData, "slot2/pass");
            if (jsonData.success) prefs.putString("pass2", jsonData.stringValue);

            json.get(jsonData, "slot3/ssid");
            if (jsonData.success) prefs.putString("ssid3", jsonData.stringValue);
            json.get(jsonData, "slot3/pass");
            if (jsonData.success) prefs.putString("pass3", jsonData.stringValue);

            prefs.end();
            Serial.println("🔄 Konfigurasi 3 WiFi baru disimpan ke Flash Memory ESP32!");
            initWiFiProfiles();
        }
    }
}

void eksekusiKontrol() {
    if (mode_operasi == "auto") {
        // === MODE AUTO ===
        // Logika kontrol otomatis dengan hysteresis
        if (suhuMedia > target_suhu + HYSTERESIS) {
            // Suhu terlalu panas -> nyalakan pendingin, matikan pemanas
            kipas_peltier = true;
            lampu_pemanas = false;
        } else if (suhuMedia < target_suhu - HYSTERESIS) {
            // Suhu terlalu dingin -> matikan pendingin, nyalakan pemanas
            kipas_peltier = false;
            lampu_pemanas = true;
        } else {
            // Suhu dalam range ideal -> matikan semua
            kipas_peltier = false;
            lampu_pemanas = false;
        }
    }
    // Mode manual: kipas_peltier dan lampu_pemanas diatur dari Firebase

    // Eksekusi ke relay
    digitalWrite(PIN_KIPAS_PELTIER, kipas_peltier ? RELAY_ON : RELAY_OFF);
    digitalWrite(PIN_LAMPU_PEMANAS, lampu_pemanas ? RELAY_ON : RELAY_OFF);
}

// ==========================================
// ========== KIRIM DATA ===================
// ==========================================

void kirimDataSensor() {
    if (!firebaseReady || !Firebase.ready() || WiFi.status() != WL_CONNECTED) return;
    if (!sensorOK || !isfinite(suhuMedia) || !isfinite(kelembaban)) {
        Serial.println("⚠️ Data sensor tidak valid; upload dibatalkan.");
        return;
    }

    const unsigned long epochTime = getEpochTime();
    if (epochTime < VALID_EPOCH_MIN) {
        Serial.println("⏳ NTP belum sinkron; upload ditunda agar timestamp bukan millis().");
        return;
    }

    // Kirim satu objek agar suhu, kelembapan, dan timestamp selalu konsisten.
    FirebaseJson sensorJson;
    sensorJson.set("suhu_media", suhuMedia);
    sensorJson.set("kelembaban", kelembaban);
    sensorJson.set("timestamp", (int)epochTime);

    if (Firebase.RTDB.setJSON(&fbData, "/sensor", &sensorJson)) {
        Serial.printf("📤 Sensor terkirim | %.1f C | %.1f %% | epoch %lu\n",
                      suhuMedia, kelembaban, epochTime);
        Firebase.RTDB.setBool(&fbData, "/status/online", true);
        Firebase.RTDB.setInt(&fbData, "/status/last_seen", (int)epochTime);
        Firebase.RTDB.setBool(&fbData, "/control/kipas_peltier", kipas_peltier);
        Firebase.RTDB.setBool(&fbData, "/control/lampu_pemanas", lampu_pemanas);
    } else {
        Serial.print("❌ Upload sensor gagal: ");
        Serial.println(fbData.errorReason());
    }
}

void simpanHistory() {
    if (!firebaseReady || !Firebase.ready() || !sensorOK) return;

    unsigned long epochTime = getEpochTime();
    if (epochTime < VALID_EPOCH_MIN) {
        Serial.println("⏳ History ditunda: NTP belum sinkron.");
        return;
    }

    // Simpan ke history menggunakan push (auto-generate key)
    FirebaseJson json;
    json.set("suhu_media", suhuMedia);
    json.set("kelembaban", kelembaban);
    json.set("target", target_suhu);
    json.set("mode", mode_operasi);
    json.set("kipas", kipas_peltier);
    json.set("pemanas", lampu_pemanas);
    json.set("timestamp", (int)epochTime);

    if (Firebase.RTDB.pushJSON(&fbData, "/history", &json)) {
        Serial.println("📊 History tersimpan");
    } else {
        Serial.println("❌ Gagal simpan history: " + fbData.errorReason());
    }
}

void updateStatus() {
    if (!firebaseReady || !Firebase.ready() || WiFi.status() != WL_CONNECTED) return;

    const unsigned long uptime = (millis() - bootTime) / 1000;
    Firebase.RTDB.setString(&fbData, "/status/wifi_ssid", WiFi.SSID());
    Firebase.RTDB.setInt(&fbData, "/status/wifi_rssi", WiFi.RSSI());
    Firebase.RTDB.setString(&fbData, "/status/ip", WiFi.localIP().toString());
    Firebase.RTDB.setInt(&fbData, "/status/uptime", uptime);
}

// ==========================================
// ========== UTILITAS =====================
// ==========================================

unsigned long getEpochTime() {
    time_t now = time(nullptr);
    if (now < VALID_EPOCH_MIN) return 0; // Jangan pernah memakai millis() sebagai Unix time.
    return (unsigned long)now;
}
