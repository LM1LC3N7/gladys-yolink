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

| YoLink device                                          | In Gladys                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Door sensor (DoorSensor)                               | open/closed, battery %                                           |
| Motion sensor (MotionSensor)                           | motion, battery %                                                |
| Leak sensor (LeakSensor)                               | water leak, battery %                                            |
| Temperature & humidity sensor (THSensor)               | temperature °C, humidity % (not on probe-less models), battery % |
| Vibration sensor (VibrationSensor)                     | vibration, battery %                                             |
| Plug, switch (Outlet, Switch)                          | on/off (settable), power W (Energy plugs)                        |
| Power strip (MultiOutlet)                              | each socket on/off (settable)                                    |
| Water valve (Manipulator, LeakStop, FlowSmart Control) | valve open/closed (settable), battery %                          |
| Lock (Lock M1, Lock M2)                                | locked (settable), battery %                                     |
| Siren (Siren)                                          | siren on/off (settable), battery %                               |
| Garage door (GarageDoor, Finger)                       | open/closed from its door sensor (settable)                      |

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

These commands are refused until you allow them in the configuration:

| Option                         | Default | Off: Gladys…                             |
| ------------------------------ | ------- | ---------------------------------------- |
| Allow unlocking the locks      | no      | can lock, never unlock                   |
| Allow opening the garage doors | no      | can close a door its sensor reports open |
| Allow opening the water valves | no      | never opens a valve                      |
| Allow closing the water valves | no      | never closes a valve                     |
| Allow stopping the sirens      | yes     | can start a siren, never stop it         |

A refused command shows a message pointing to the option. To shut the water
off from a scene on a leak, turn on "Allow closing the water valves". A siren
whose stopping is off stops by itself after the alarm duration set in the
YoLink app.

A YoLink garage door only knows a "toggle" command:

- just before toggling, the integration reads the paired door sensor again;
  when there is none, or it is offline or gives no state, the command is
  refused (a toggle could do the opposite);
- the commands of one garage run one at a time; after a toggle, any new
  command of that garage is refused with a "command ignored" message for 60
  seconds or until the sensor reports a change: a second "close" sent while
  the door moves would open it again;
- **limit**: a door already moving by other means (remote, wall button, the
  YoLink app) may be reversed by a "close" from Gladys, because the YoLink API
  cannot tell that it moves: the sensor only says "open" or "closed".

## How the values arrive

- **Live** ("Live events" option, on by default): the integration subscribes
  to the MQTT events of your YoLink home. A door opening, a motion or a leak
  arrive within a second or two. Every alert is recorded, even two alerts in a
  row. Read "Privacy" before leaving it on.
- **Full refresh**: at start, then every 30 minutes (10 to 1440), the
  integration reads the device list and the state of each device again over
  HTTPS (one request per device, half a second apart). Without the live
  events, this is the only source of the values.
- The devices of the European zone ("-EC" models) are read on YoLink's EU
  cloud, the others on the US cloud, as the app does.
- YS6801 power strip: channel 0 is the USB ports, channels 1 to 4 are sockets
  1 to 4.

## Usage limits

- YoLink allows one access credential 5 open MQTT connections and 10 new
  connections per 5 minutes: the integration uses one per cloud (two at most)
  and never opens more than 8 per 5 minutes. Do not share one credential
  between several programs (Home Assistant, Gladys…): make one per program.
- When YoLink answers "limits reached", the integration pauses for 15
  minutes, during which neither Discovery nor the test button reads YoLink; on
  a network error it retries after 1, 2, 5, 10 then 15 minutes.
- Gladys accepts 300 states per minute: beyond, the values wait for the next
  minute.

## Options

| Option                          | Default | Role                                           |
| ------------------------------- | ------- | ---------------------------------------------- |
| UAID, secret key                | —       | the access credential made in the YoLink app   |
| Allow unlocking, garage, valves | no      | see "Safety"                                   |
| Allow stopping the sirens       | yes     | see "Safety"                                   |
| Live events (unencrypted MQTT)  | yes     | see "Privacy"                                  |
| Full refresh interval (min)     | 30      | how often everything is read again             |
| Language of the feature names   | French  | feature names of the devices added from now on |

## Troubleshooting

- **"YoLink refused the UAID or the secret key"**: check them (the credential
  may have been deleted in the app). The integration waits for a change or a
  click on **Test the connection**.
- **`cloud` badge with an orange dot "Live events paused"**: the MQTT
  connection dropped, the integration reconnects (30 s, then up to 5 min).
  The values arrive at the next refresh at the latest.
- **`unreachable` badge with an orange dot**: YoLink reports the device
  offline (batteries, hub range).
- **"The LeakStop did not answer"**: in its power-saving (class A) mode it
  only listens from time to time; try again, or change its mode in the YoLink
  app.
- **A device is missing**: its type is not supported yet; open an issue on
  the GitHub repository with its model. The FlowSmart Meter (YS5007), which
  has no valve, is skipped.

## Privacy

The UAID and the secret key are stored by Gladys as secrets (the key is never
sent back to the browser). The key only goes to
`api.yosmart.com/open/yolink/token` (HTTPS) to get an access token, which stays
in memory (nothing is written to `/data`).

**The live events are not encrypted.** They go through YoLink's MQTT broker
on port 8003, without TLS: the only mode YoLink documents (port 8004 is
WebSocket, without TLS too). The access token travels there **in clear** as
the user name. Anyone watching your network (or the path to YoLink) can read
it and, for about 2 hours (its lifetime), **command every YoLink device of
yours, unlocking the locks and opening the garage included**, whatever the
Gladys options. The secret key never goes there. If that risk is not
acceptable, turn the "Live events" option off: only the HTTPS reads remain,
at every full refresh.

YoLink is a trademark of YoSmart; this integration is not affiliated with
YoSmart.
