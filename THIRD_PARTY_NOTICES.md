# Third-party notices

## shadcn-admin

Source: https://github.com/satnaing/shadcn-admin
Reference revision: e16c87f213a5ba5e45964e9b67c792105ec74d26

ContextWeave adapts the data table toolbar, faceted filter, column visibility,
selection, command input and CRUD composition patterns to its Base UI components,
TanStack Table v9, desktop runtime, localization and dynamic theme settings.

MIT License

Copyright (c) 2024 Sat Naing

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

## New API design inspiration

Theme settings interactions and visual organization are inspired by
https://github.com/QuantumNous/new-api. ContextWeave's theme implementation, SVG
previews and other theme resources are independently authored; New API code and
assets are not included in these adaptations.

These notices concern third-party material only and do not grant a license for
ContextWeave as a whole. Other dependencies retain their respective licenses.

## fingerprint-chromium

Source: https://github.com/adryfish/fingerprint-chromium

The optional browser is downloaded from its author's official releases, after a user chooses a version. Each environment pins that version. ContextWeave implements its own installer and adapter. Upstream Chromium and other third-party notices remain in the original browser bundle (also accessible through `chrome://credits`). The repository's license below does not replace those component licenses. The release source publication may lag behind binaries; no reproducible-build claim is made.

BSD 3-Clause License

Copyright (c) 2015-2023, The ungoogled-chromium Authors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Proxy transport and archive dependencies

- `proxy-chain` 3.0.1 — Apache-2.0; https://github.com/apify/proxy-chain
- `https-proxy-agent` 9.1.0 — MIT; https://github.com/TooTallNate/proxy-agents
- `yauzl` 3.4.0 — MIT; https://github.com/thejoshwolfe/yauzl

These libraries run in the desktop main process. Their original package license files are retained with the application dependencies. No telemetry is introduced by their integration.
