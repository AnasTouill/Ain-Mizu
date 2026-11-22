# Physarum-Grid controller on Wokwi (online)

[Wokwi](https://wokwi.com) is a free Arduino simulator that runs in the browser: no install, no licence.

The board is an **ESP32** programmed with the same Arduino code. An Arduino Uno has no network, so it could never talk to the website; the ESP32 has Wi-Fi, and in Wokwi it reaches the internet through the `Wokwi-GUEST` network.

| Platform feature | On the Wokwi board |
|---|---|
| A parcel's watering switch | Button **V1…V4** → green valve LED |
| Start / stop the pump | Button **POMPE** → relay clicks, blue LED |
| Pump refused with every valve closed | Serial Monitor `ERR DRY_RUN` |
| Soil-moisture sensors | Potentiometers **H1…H4** |
| Parcel classes green / yellow / orange / red | **4 RGB lights P1–P4** in the website's colours, plus LCD page 2 `P1V P2J P3O P4R` |
| Alert: dry parcel without water | Its RGB light **blinks** and the **buzzer** beeps every 3 s (red parcel with a closed valve) |
| Water tank | Slider **CUVE**: the pump refuses to start below 10 % (`ERR TANK_EMPTY`) and stops if the tank runs dry |
| Automatic plan | **MODE** slide switch → AUTO waters parcels below 40 % by itself (only if the tank has water) |
| Serial monitor | Wokwi Serial Monitor: shows every message and accepts commands |
| **Website link (later)** | Sends its sensors and tank level every 2 s, applies the valve and pump orders from the website |

Files: `sketch.ino` (code), `diagram.json` (circuit), `libraries.txt` (libraries: LiquidCrystal I2C, Adafruit NeoPixel).

## Import into Wokwi (2 minutes)

1. Open **https://wokwi.com/projects/new/esp32**. Sign in if you want to save the project.
2. **sketch.ino** tab: select everything and paste the content of `sketch.ino`.
3. **diagram.json** tab: select everything and paste the content of `diagram.json`. The circuit appears.
4. **Library Manager** tab: click **+** and add **LiquidCrystal I2C** (not "Multilingual"). Click **+** again and add **Adafruit NeoPixel**. Alternatively, add a file named `libraries.txt` with the content of ours.
5. Press the green **▶**. Wokwi compiles the sketch (20–60 s on the free plan), the LCD lights up and the Serial Monitor prints the help text.
6. **Save** (signed in) to keep the project and get a link you can share.

These exact files were checked on wokwi.com. They compile and run: the help text appears, the LCD pages rotate, the valve LEDs and RGB lights turn on, and with the tank at 0 % the pump is held off (`ALERT TANK_EMPTY`). Not clicked during that check: the buttons, the MODE switch, the tank slider and the buzzer alarm.

## Use

- **MODE switch** (left side of the circuit):
  - **AUTO:** the board waters every parcel below 40 % moisture and starts the pump by itself.
  - **MANUEL:** you decide.
- **Buttons V1–V4** open or close a valve. **POMPE** starts or stops the pump (MANUEL only).
- **Potentiometers H1–H4:** click one and drag to change that parcel's moisture. At start they are at 0 % (dry), so AUTO waters everything until you turn them up.
- **Slider CUVE:** the water tank. It starts empty, so **first slide it up**, otherwise the pump stays off and the LCD shows `Cuve 00% VIDE`.
- **RGB lights P1–P4:** each parcel's class colour. A blinking red light plus a beep means "dry but not watered": open its valve.
- **Serial Monitor** commands (type, then Enter):

  | Command | Effect |
  |---|---|
  | `V2:1` / `V2:0` | Open / close valve 2 |
  | `P1` / `P0` | Pump on / off |
  | `S?` | State + sensor readings |
  | `HELP` | Command list |

- **Board messages:**

  | Message | Meaning |
  |---|---|
  | `OK V2:1` | Applied |
  | `ST:P1:V0100` | State: pump on, valve 2 open |
  | `M:2:154` | Sensor 2 moved |
  | `ERR DRY_RUN` | Pump refused: every valve is closed |
  | `ERR AUTO_MODE` | Manual action refused in AUTO |
  | `T:72` | Tank level moved (%) |
  | `ERR TANK_EMPTY` / `ALERT TANK_EMPTY` | Pump refused / tank below 10 % (pump stopped) |

- **LCD:**
  ```
  V1011 P:ON  AUTO     <- valves, pump, mode (MANU / LINK when the website drives it)
  H 45 16 85 32  %     <- moisture of parcels 1..4, alternating with
  P1J P2R P3V P4O      <- class of each parcel, then
  Cuve 72% Al:P2       <- tank level + parcels in alarm (VIDE = empty tank)
  ```

## Connect to the website (later)

Wokwi runs online, so it cannot see `localhost`. Expose the backend with a temporary tunnel.

1. Start the platform as usual: backend on port 8000, frontend on 5173.
2. Open a public tunnel to the backend. Cloudflare's free quick tunnel needs no account (download `cloudflared` from Cloudflare first):
   ```powershell
   cloudflared tunnel --url http://localhost:8000
   ```
   It prints an address like `https://abc-123.trycloudflare.com`.
3. In `sketch.ino`, set:
   ```cpp
   const char *PLATFORM_URL = "https://abc-123.trycloudflare.com";
   ```
   Then restart the simulation. The Serial Monitor shows `WiFi OK`, then `LINK OK`, and the LCD shows `LINK`.
4. On the website, open a farm in **Mon exploitation** (Aujourd'hui). With the board in **MANUEL**:
   - The farm's watering switches open and close valve *n* = parcel *n* on the Wokwi board.
   - **Démarrer la pompe** clicks the relay.
   - Turning a potentiometer shows **Capteur : xx %** on that parcel's card, and on the **Contrôleur** page, within 2 s.
   - In **AUTO**, the board decides by itself; the website still receives its sensors.

**How it works:** every 2 s the board calls `POST /api/hardware/board/report` with `{"moisture":[45,16,85,32],"tank":72}`. The backend answers with the website's orders, for example `{"farmer_id":"keb_farm_04","pump":true,"valves":[true,false,true,false]}`. This endpoint is already in the backend.

**Security:** while the tunnel is open, anyone with the address can reach the API, which has no login. Open it only for the demo and close it (Ctrl+C) afterwards.
