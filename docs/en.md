# YoLink

This integration brings the **YoLink** devices (YoSmart) of a YoLink hub into
Gladys, through the **official YoLink Open API v2**: the same account as the
YoLink app, no hack. Unofficial, not affiliated with YoSmart.

> **Development version (0.1).** Written from the official documentation
> (doc.yosmart.com) and YoSmart's official Python library `yolink-api`,
> tested with simulated answers, not yet with real devices. Feedback is
> welcome on the GitHub repository.

## What you get

One Gladys device per supported YoLink device:

| YoLink device                                  | In Gladys                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Door sensor (DoorSensor)                       | open/closed, battery %                                           |
| Motion sensor (MotionSensor)                   | motion, battery %                                                |
| Leak sensor (LeakSensor)                       | water leak, battery %                                            |
| Temperature & humidity sensor (THSensor)       | temperature °C, humidity % (not on probe-less models), battery % |
| Vibration sensor (VibrationSensor)             | vibration, battery %                                             |
| Plug, switch (Outlet, Switch)                  | on/off (settable), power W (Energy plugs)                        |
| Power strip (MultiOutlet)                      | each socket on/off (settable)                                    |
| Water valve (Manipulator, LeakStop, FlowSmart) | valve open/closed (settable), battery %                          |
| Lock (Lock M1, Lock M2)                        | locked (settable), battery %                                     |
| Siren (Siren)                                  | siren on/off (settable), battery %                               |
| Garage door (GarageDoor, Finger)               | open/closed from its door sensor (settable)                      |

Hubs, remotes, thermostats, sprinklers and other types are not supported yet:
the **Test the connection** button tells how many devices are skipped.

## Installation

1. In the YoLink app: **Account** > **Advanced Settings** > **Personal Access
   Credentials**, then **+** to make one. Note its **UAID** and **secret key**.
2. Install the integration from the Gladys store.
3. In the **Configuration** tab, enter the UAID and the secret key, then save.
   The status reads "Connected to YoLink: 12 devices. Live events on."
4. Open the **Discovery** tab and add the devices you want. Their values
   arrive as soon as they are added.

## Safety: commands off by default

Three commands are refused until you allow them in the configuration:

| Option                         | Off: Gladys can…                             |
| ------------------------------ | -------------------------------------------- |
| Allow unlocking the locks      | lock, never unlock                           |
| Allow opening the garage doors | close a door its sensor reports open         |
| Allow opening the water valves | close a valve (shut the water off on a leak) |

A refused command shows a message pointing to the option. A YoLink garage
door only knows a "toggle" command: without a paired door sensor its state is
unknown, and even closing needs the opening allowed (a toggle could open it).

## How the values arrive

- **Live**: the integration subscribes to the MQTT events of your YoLink
  home. A door opening, a motion or a leak arrive within a second or two.
  Every alert is recorded, even two alerts in a row.
- **Full refresh**: at start, then every 30 minutes (10 to 1440), the
  integration reads the device list and the state of each device again (one
  request per device, half a second apart).
- The devices of the European zone ("-EC" models) are read on YoLink's EU
  cloud, the others on the US cloud, as the app does.

## Usage limits

- YoLink allows one access credential 5 open MQTT connections and 10 new
  connections per 5 minutes: the integration uses one per cloud (two at most)
  and never opens more than 8 per 5 minutes. Do not share one credential
  between several programs (Home Assistant, Gladys…): make one per program.
- When YoLink answers "limits reached", the integration pauses for 15
  minutes; on a network error it retries after 1, 2, 5, 10 then 15 minutes.
- Gladys accepts 300 states per minute: beyond, the values wait for the next
  minute.

## Options

| Option                           | Default | Role                                           |
| -------------------------------- | ------- | ---------------------------------------------- |
| UAID, secret key                 | —       | the access credential made in the YoLink app   |
| Allow unlocking / garage / valve | no      | see "Safety"                                   |
| Full refresh interval (min)      | 30      | how often everything is read again             |
| Language of the feature names    | French  | feature names of the devices added from now on |

## Troubleshooting

- **"YoLink refused the UAID or the secret key"**: check them (the credential
  may have been deleted in the app). The integration waits for a change or a
  click on **Test the connection**.
- **`cloud` badge with an orange dot "Live events paused"**: the MQTT
  connection dropped, the integration reconnects (30 s, then up to 5 min).
  The values arrive at the next refresh at the latest.
- **`unreachable` badge with an orange dot**: YoLink reports the device
  offline (batteries, hub range).
- **A device is missing**: its type is not supported yet; open an issue on
  the GitHub repository with its model.

## Privacy

The UAID and the secret key are stored by Gladys as secrets (the key is never
sent back to the browser). The key only goes to
`api.yosmart.com/open/yolink/token` (HTTPS) to get an access token, which stays
in memory (nothing is written to `/data`). The live events go through YoLink's
MQTT broker on port 8003, **unencrypted**: the only mode YoLink documents
(port 8004 is WebSocket, without TLS too). The access token, valid 2 hours,
travels there as the user name; the secret key never does. YoLink is a
trademark of YoSmart; this integration is not affiliated with YoSmart.
