# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, under its own licence.

## yolink-api

- Project: [YoSmart-Inc/yolink-api](https://github.com/YoSmart-Inc/yolink-api),
  YoSmart's official Python library for the YoLink Open API v2 (the one of
  the Home Assistant integration).
- What is ported (rewritten in JavaScript in `src/constants.js`,
  `src/client.js`, `src/inventory.js` and `src/live.js`): the API and MQTT
  endpoints, the US/EU split of the devices and their EU tokens, the device
  types, the MQTT events kept, the paired devices (`parentDeviceId`), the
  `fetchState` reading and the battery levels 0-4.
- Licence: MIT. The licence file of the project reads:

```
Copyright (c) 2018 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
