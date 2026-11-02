# Exploring Motion

A professional motion-graphics editor for Windows — layers, keyframes, a real
camera with depth parallax, video & audio layers, and one-click export.
An original, clean-room build by **Exploring Tech** («تقنية المستقبل»).

![icon](build/icon.png)

## Download

Grab the portable build from the **Releases** page:

- `Exploring-Motion-Portable-1.1.0.exe` — no installation, just run it.
- The executable is not code-signed yet, so Windows SmartScreen may warn on
  first launch (More info → Run anyway).

## Features (v1.1.0)

- **Layers**: shapes, text (12 bundled Arabic/Latin font families), images,
  video, audio, camera, null and group layers — with parenting (position
  preserving), blend modes (16), masks and layer reorder/lock.
- **Animation**: per-property keyframes with cubic-bezier easing, a full
  **Graph Editor** with draggable keys and bezier handles, undo/redo.
- **Camera system**: X/Y/Z with true depth parallax, focus depth, depth of
  field blur, fog, 7 camera-move presets, and camera parenting to Nulls.
- **Effects**: 15 stackable, keyframable effects (blur, glow, shadow, hue,
  pixelate, noise, sharpen…) baked per layer.
- **Media engine**: video layers with filmstrip thumbnails in the timeline,
  audio layers with real waveform display, a floating clip toolbar
  (split at playhead / add keyframes / duplicate / delete), synced preview.
- **Export**: MP4 (H.264), WebM (VP9), GIF or PNG sequence at 24/30/60 fps,
  with audio layers mixed in (offset, delay and volume honoured), rendered
  frame-accurately through the bundled FFmpeg.

## Build from source

```bash
npm install
npm start            # run in development
npx electron-builder --win   # portable Windows .exe into dist/
```

Stack: Electron 45 · Fabric.js 5.3 · FFmpeg (bundled for Windows via
`@ffmpeg-installer/win32-x64`).

## Notes

- Exploring Motion is an original implementation written from scratch.
  Design concepts were studied from two MIT-licensed open-source projects —
  [Open-Motion](https://github.com/Hada45) by Hada45 and
  [Motionity](https://github.com/alyssaxuu) by alyssaxuu — with gratitude;
  no code or assets from any commercial editor are used.
- Project files are plain JSON (Save/Open in the top bar).

## License

Copyright © 2026 Exploring Tech. All rights reserved for now — a public
license will be chosen by the author.
