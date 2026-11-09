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

// ==========================================
// ========== KONFIGURASI ==================
// ==========================================

// Default 3 Profil WiFi (akan disimpan di flash memory NVS ESP32)
// Pengguna juga bisa mengganti ini kapan saja lewat Web App!
#define DEFAULT_SSID_1       "Home_WiFi_2.4G"
#define DEFAULT_PASS_1       "maggot2024"

#define DEFAULT_SSID_2       "Hotspot_TeknoBro"
#define DEFAULT_PASS_2       "teknobro123"

#define DEFAULT_SSID_3       "Kandang_Maggot_IoT"
#define DEFAULT_PASS_3       "bsfberkah"

// Firebase
#define FIREBASE_HOST   "PROJECT-ID.firebaseio.com"  // Tanpa https://
#define FIREBASE_API_KEY "YOUR_API_KEY"

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
#define STATUS_UPDATE_INTERVAL  30000   // Update status online setiap 30 detik

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
    if (now - lastFirebaseSend >= FIREBASE_SEND_INTERVAL) {
        lastFirebaseSend = now;
        kirimDataSensor();
    }

    // 5. Simpan history
    if (now - lastHistorySave >= HISTORY_SAVE_INTERVAL) {
        lastHistorySave = now;
        simpanHistory();
    }

    // 6. Update status online
    if (now - lastStatusUpdate >= STATUS_UPDATE_INTERVAL) {
        lastStatusUpdate = now;
        updateStatus();
    }

    // Reconnect WiFi jika terputus
    if (WiFi.status() != WL_CONNECTED) {
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
    while (wifiMulti.run() != WL_CONNECTED && attempts < 25) {
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
    Serial.println("🔥 Mengkonfigurasi Firebase...");

    config.api_key = FIREBASE_API_KEY;
    config.database_url = FIREBASE_HOST;

    // Anonymous auth (atur rules Firebase agar allow read/write)
    Firebase.begin(&config, &auth);
    Firebase.reconnectNetwork(true);

    // Cek koneksi
    if (Firebase.ready()) {
        firebaseReady = true;
        Serial.println("✅ Firebase terhubung!");

        // Set status online
        Firebase.RTDB.setBool(&fbData, "/status/online", true);
        Firebase.RTDB.setInt(&fbData, "/status/last_seen", getEpochTime());

        // Baca kontrol awal
        cekKontrolFirebase();
    } else {
        Serial.println("❌ Gagal terhubung Firebase!");
        firebaseReady = false;
    }
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
    if (!firebaseReady || !Firebase.ready()) return;

    unsigned long epochTime = getEpochTime();

    // Update sensor data
    Firebase.RTDB.setFloat(&fbData, "/sensor/suhu_media", suhuMedia);
    Firebase.RTDB.setFloat(&fbData, "/sensor/kelembaban", kelembaban);
    Firebase.RTDB.setInt(&fbData, "/sensor/timestamp", epochTime);

    // Update control state (untuk sinkronisasi mode auto)
    Firebase.RTDB.setBool(&fbData, "/control/kipas_peltier", kipas_peltier);
    Firebase.RTDB.setBool(&fbData, "/control/lampu_pemanas", lampu_pemanas);

    Serial.println("📤 Data terkirim ke Firebase");
}

void simpanHistory() {
    if (!firebaseReady || !Firebase.ready()) return;

    unsigned long epochTime = getEpochTime();

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
    if (!firebaseReady || !Firebase.ready()) return;

    unsigned long uptime = (millis() - bootTime) / 1000;

    Firebase.RTDB.setBool(&fbData, "/status/online", true);
    Firebase.RTDB.setInt(&fbData, "/status/last_seen", getEpochTime());
    Firebase.RTDB.setString(&fbData, "/status/wifi_ssid", WiFi.SSID());
    Firebase.RTDB.setInt(&fbData, "/status/wifi_rssi", WiFi.RSSI());
    Firebase.RTDB.setString(&fbData, "/status/ip", WiFi.localIP().toString());
    Firebase.RTDB.setInt(&fbData, "/status/uptime", uptime);
}

// ==========================================
// ========== UTILITAS =====================
// ==========================================

unsigned long getEpochTime() {
    time_t now;
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        return millis() / 1000;
    }
    time(&now);
    return now;
}
