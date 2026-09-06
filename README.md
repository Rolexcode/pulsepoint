# PulsePrint

PulsePrint is a deliberately small Hack2Heal proof of concept. It uses a phone's rear camera and flash to sample fingertip photoplethysmography (PPG) in the browser, estimate pulse rate from a usable signal, and compare recent readings with a local personal baseline.

The entire measurement pipeline runs in the browser. No frames, waveform samples, or readings are uploaded.

## What the prototype does

- Requests the rear camera with `getUserMedia`
- Attempts torch control when the browser exposes the constraint
- Samples mean red-channel intensity from a central camera region
- Detrends and smooths the raw optical signal
- Estimates BPM using autocorrelation with a peak-interval cross-check
- Rejects short, dark, saturated, flat, or weakly periodic signals
- Stores up to five valid readings in versioned `localStorage`
- Builds a simple personal range after repeated valid readings

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Camera access is allowed on `localhost`, but testing from another phone on your local network normally requires HTTPS.

## Verify

```bash
npm run lint
npm test
npm run build
```

## Deploy to Vercel

The quickest phone-test path is a Vercel HTTPS preview:

```bash
npx vercel
```

After checking the preview on the phone, publish the production deployment:

```bash
npx vercel --prod
```

No environment variables or external services are required.

## Phone measurement

1. Open the HTTPS deployment in a recent mobile Chrome browser.
2. Tap **Start measurement** and allow camera access.
3. Gently cover the rear camera and flash with a fingertip.
4. Keep the phone and hand still for 24 seconds.
5. If a reading is rejected, adjust coverage or pressure and repeat.

Torch control is not standardized across every phone/browser combination. PulsePrint continues with a clear fallback when the torch constraint is unavailable.

## Scientific and safety limits

This is a hackathon prototype, not a medical device or diagnosis. Smartphone cameras differ, and PPG is sensitive to motion, pressure, ambient light, temperature, skin pigmentation, device processing, and sensor saturation. The quality gate is intentionally conservative, but it has not been clinically validated. A baseline describes only the recent readings saved in this browser and must not be interpreted as a clinical reference range.

Stop the measurement if the phone or flash feels uncomfortably warm.
