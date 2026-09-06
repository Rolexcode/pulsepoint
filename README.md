# PulsePrint

PulsePrint is a browser-based photoplethysmography (PPG) prototype that uses a phone's rear camera and flash to capture fingertip pulse signals, estimate BPM from usable recordings, and build a simple personal baseline from recent measurements.

**Live demo:** https://pulsepoint-gold-pi.vercel.app/

> Prototype only — not a medical device, diagnosis, or substitute for professional care.

## How it works

1. The user covers the rear camera and flash with a fingertip.
2. PulsePrint samples light-intensity changes from the camera feed in the browser.
3. The signal is detrended and smoothed.
4. BPM is estimated using autocorrelation with a peak-interval cross-check.
5. A quality gate rejects recordings that are too short, dark, saturated, flat, or insufficiently periodic.
6. Valid readings are stored locally and used to form a simple personal baseline.

No video, waveform samples, or readings are uploaded. Processing happens locally in the browser.

## Features

- Rear-camera capture with `getUserMedia`
- Torch support where the browser/device exposes it
- Live PPG waveform
- Signal-quality checks and safe rejection of unreliable readings
- BPM estimation from valid signals
- Recent reading history stored in `localStorage`
- Simple personal baseline after repeated valid readings
- Responsive mobile-first interface
- No backend, account, database, or external API required

## Tech stack

- Next.js
- TypeScript
- React
- Canvas API
- MediaDevices / `getUserMedia`
- Browser-side signal processing
- Vercel

## Run locally

Requires Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Camera access works on `localhost`; testing from another device generally requires HTTPS.

## Verification

```bash
npm run lint
npm test
npm run build
```

The signal tests include synthetic pulse rates across the supported range and a flat-signal case that must be rejected rather than assigned a BPM.

## Phone measurement tips

For the cleanest signal:

- Use the HTTPS deployment in a recent mobile browser.
- Cover the rear camera and flash fully but gently.
- Keep your hand and phone completely still during the measurement.
- Avoid pressing hard enough to restrict blood flow or saturate the camera.
- Warm cold hands before measuring.
- Retry if PulsePrint rejects the recording.

Torch control is not standardized across every phone/browser combination, so the app falls back gracefully when it is unavailable.

## Current limitations

Smartphone PPG quality varies with motion, finger pressure, ambient light, skin pigmentation, temperature, camera hardware, automatic exposure/white-balance processing, and sensor saturation. PulsePrint intentionally rejects uncertain recordings instead of forcing a BPM result.

The current baseline is only a comparison with recent valid readings stored in the same browser. It is not a clinical reference range.

## Hack2Heal 2.0

PulsePrint was developed as a working proof of concept for Hack2Heal 2.0, exploring whether repeated smartphone-camera PPG can support within-person deviation monitoring while abstaining when signal quality is insufficient.
