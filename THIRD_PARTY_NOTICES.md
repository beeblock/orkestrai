# Third-Party Notices

Orkestrai uses third-party software, models, services, names, and trademarks.
Their licenses apply to those components independently from the license selected
for Orkestrai's own source code.

## Optional Video Assembly Encoder

FFmpeg/FFprobe are separate command-line executables downloaded only after owner
confirmation. They are not linked into Orkestrai and are not in its installers.
The pinned 9.0.1 builds enable GPL components (including x264) and are licensed
under GPL-3.0-or-later, independently of Orkestrai's Apache-2.0 source.

- FFmpeg license and source: <https://ffmpeg.org/legal.html>, <https://ffmpeg.org/download.html>
- macOS builds and corresponding build scripts: <https://ffmpeg.martin-riedl.de/>,
  <https://git.martin-riedl.de/ffmpeg/build-script>
- Windows/Linux builds and source/build recipes: <https://github.com/BtbN/FFmpeg-Builds>
- Exact archive URLs and SHA-256 values: `SequenceEncoderRuntime.ts`; downloaded
  installations retain an `installed.json` manifest and `NOTICE.txt`.

Do not mirror or redistribute these binaries without independently satisfying
their corresponding-source and license obligations. Codec patent requirements
depend on the jurisdiction and use; this notice is not a patent license.

## Cua Driver

- Purpose: native Computer-control backend under development; not a separate
  agent or a replacement for Orkestrai permissions and audit.
- SDK: `@trycua/cua-driver` 0.28.1, MIT.
- Native packages: MIT and MPL-2.0; UniFFI bindings (`@ubjs/core` and
  `@ubjs/node` 0.31.0-3) are MPL-2.0.
- Source and corresponding native-runtime build transformations:
  <https://github.com/trycua/cua/tree/cua-driver-rs-v0.28.1>
- MPL-2.0: <https://www.mozilla.org/MPL/2.0/>

The native package includes `node-runtime-NOTICE.md` describing its compatibility
runtime derived from `uniffi-bindgen-react-native`. Preserve the dependency's
notices when distributing its unmodified binaries. The SDK package version does
not imply acceptance of every operating system, application or input route.

## Embedded Voice

Orkestrai downloads voice models only after user confirmation and executes them
locally through sherpa-onnx.

### NVIDIA Parakeet-TDT 0.6B v3

- Purpose: multilingual speech-to-text
- Copyright: NVIDIA Corporation and contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- Model card: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>
- ONNX archive provider: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models>

The model archive used by Orkestrai is an ONNX/int8 conversion distributed by
the sherpa-onnx project. NVIDIA does not endorse Orkestrai.

### Supertonic 3

- Purpose: multilingual text-to-speech
- Copyright: 2026 Supertone Inc.
- Model license: OpenRAIL-M
- Project and license information: <https://github.com/supertone-inc/supertonic>
- Model license: <https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE>
- ONNX archive provider: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models>

The Supertonic sample code is MIT-licensed, while the model weights downloaded
by Orkestrai are governed by the separate OpenRAIL-M model license. Supertone
does not endorse Orkestrai.

### sherpa-onnx

- Purpose: local ONNX inference for speech-to-text and text-to-speech
- Copyright: the sherpa-onnx contributors
- License: Apache License 2.0
- Source: <https://github.com/k2-fsa/sherpa-onnx>

The npm package `sherpa-onnx-node` and its native libraries are distributed
under their accompanying notices and license files.

## Node.js Runtime

Orkestrai downloads a standalone Node.js runtime for the isolated voice worker
when a suitable system runtime is unavailable.

- Copyright: Node.js contributors
- License: MIT and additional licenses listed by the Node.js distribution
- Source and notices: <https://github.com/nodejs/node/blob/main/LICENSE>

## Bundled Fonts

The following variable fonts are bundled through Fontsource and remain licensed
under the SIL Open Font License 1.1:

- Inter: Copyright 2016 The Inter Project Authors.
  Source: <https://github.com/rsms/inter>
- Sora: Copyright 2019 The Sora Project Authors.
  Source: <https://github.com/sora-xor/sora-font>
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors.
  Source: <https://github.com/JetBrains/JetBrainsMono>

The complete OFL-1.1 text accompanies each `@fontsource-variable` package in
the installed dependency graph. The fonts are not sold by themselves and their
project names do not imply endorsement of Orkestrai.

## Workbench Search And Virtualization

- `@tanstack/svelte-virtual`: Copyright TanStack contributors, MIT License.
  Source: <https://github.com/TanStack/virtual>
- `@vscode/ripgrep`: Copyright Microsoft Corporation and contributors, MIT
  License. It bundles the ripgrep executable, which is dual-licensed under MIT
  or the Unlicense. Source: <https://github.com/microsoft/vscode-ripgrep>

These packages provide bounded rendering for large search result sets and
workspace-confined file search. Their license files remain in the installed
dependency graph.

## Workbench Editor And Previews

- `monaco-editor`: Copyright Microsoft Corporation, MIT License.
  Source: <https://github.com/microsoft/monaco-editor>
- `pdfjs-dist`: Copyright Mozilla Foundation, Apache License 2.0.
  Source: <https://github.com/mozilla/pdf.js>

These packages provide the local code editor and PDF preview. Their workers and
assets are bundled with the desktop app so these surfaces remain available
offline.

## Embedded PDF OCR

- `tesseract.js` and `tesseract.js-core`: Apache License 2.0.
  Sources: <https://github.com/naptha/tesseract.js> and
  <https://github.com/naptha/tesseract.js-core>.
- `@tesseract.js-data/eng`, `/por`, and `/spa`: npm wrappers are MIT-licensed;
  the upstream Tesseract trained language data is Apache-2.0.
  Sources: <https://github.com/naptha/tessdata> and
  <https://github.com/tesseract-ocr/tessdata_best>.
- `@napi-rs/canvas`: MIT, with Skia and other third-party components covered by
  its distributed notices. Source: <https://github.com/Brooooooklyn/canvas>.

The OCR engine, language data and PDF rasterizer are bundled for offline document
extraction. No document is uploaded to an OCR service. Their package license files
and notices must remain included in the desktop distribution.

## Design Studio Vector Import

- `svg-pathdata`: Copyright Mikael Engel and contributors, MIT License.
  Source: <https://github.com/nfroidure/svg-pathdata>

This package converts SVG path commands into Orkestrai's editable native vector
geometry. Orkestrai does not bundle or execute code from imported SVG files.

## API Client Script Runtimes

- `postman-runtime` and `postman-collection`: Copyright Postman, Inc. and
  contributors, Apache License 2.0. Sources:
  <https://github.com/postmanlabs/postman-runtime> and
  <https://github.com/postmanlabs/postman-collection>
- `@postman/tough-cookie`: Copyright Salesforce.com, Inc. and contributors,
  BSD 3-Clause License. Source:
  <https://github.com/postmanlabs/tough-cookie>
- `@usebruno/js` and `@usebruno/requests`: Copyright Bruno contributors, MIT
  License. Source: <https://github.com/usebruno/bruno>

These packages execute imported collection scripts through their native API
contracts. Postman and Bruno do not sponsor or endorse Orkestrai. Postman cloud
services and the Bruno desktop application are not bundled.

## Apple Simulator Integration

- `serve-sim`: Copyright Evan Bacon and contributors, Apache License 2.0.
  Source: <https://github.com/EvanBacon/serve-sim>

Orkestrai uses `serve-sim` as a loopback-only streaming and control helper for
Apple Simulators. Xcode and Apple Simulator runtimes are supplied separately by
Apple and are not distributed with Orkestrai.

## Android Device Integration

- `@yume-chan/adb`, `@yume-chan/adb-server-node-tcp`,
  `@yume-chan/adb-scrcpy`, `@yume-chan/scrcpy`,
  `@yume-chan/scrcpy-decoder-webcodecs`, and `@yume-chan/stream-extra`:
  Copyright Tango contributors, MIT License.
  Source: <https://github.com/yume-chan/ya-webadb>
- scrcpy server 3.1: Copyright Genymobile and contributors, Apache License 2.0.
  Source: <https://github.com/Genymobile/scrcpy/releases/tag/v3.1>

Orkestrai bundles only the scrcpy Android server component and sends it to the
selected device over the user's local ADB server. Android Studio, Android SDK
Platform Tools, Emulator images, and physical-device drivers are supplied
separately by Google, device vendors, or the user and are not distributed with
Orkestrai.

## Agent Providers And Trademarks

Claude and Anthropic are trademarks of Anthropic PBC. Codex and OpenAI are
trademarks of OpenAI. Kimi is a trademark of Moonshot AI. OpenCode and other
third-party names and logos belong to their respective owners.

Their inclusion identifies compatible command-line tools. It does not imply
sponsorship, endorsement, or affiliation unless explicitly stated by the
respective owner.

## Bundled Agent Skills

The following development-agent skills are included under the MIT License:

- `design-taste-frontend`: Copyright (c) 2026 Leonxlnx.
  Source: <https://github.com/Leonxlnx/taste-skill>
- `make-interfaces-feel-better`: Copyright (c) 2026 Jakub Krehel.
  Source: <https://github.com/jakubkrehel/make-interfaces-feel-better>
- `web-design-guidelines`: Copyright (c) 2025 Vercel Labs.
  Source: <https://github.com/vercel-labs/web-interface-guidelines>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## JavaScript Dependencies

The complete, reproducible dependency graph is recorded in `package-lock.json`.
Installed npm packages include their own license files and notices. Direct
runtime dependencies are predominantly licensed under MIT, Apache-2.0, ISC,
MPL-2.0, or the Unlicense; each package remains governed by its own terms.
