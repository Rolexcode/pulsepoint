# PulsePrint

PulsePrint is a browser-based photoplethysmography (PPG) prototype that uses a phone's rear camera and flash to capture fingertip pulse signals, estimate BPM from usable recordings, and build a simple personal baseline from recent measurements.

**Live prototype:** https://pulsepoint-gold-pi.vercel.app/

> Prototype only — not a medical device, diagnosis, or substitute for professional care.

## The idea

Most consumer heart-rate tools answer a one-time question: *what is my heart rate right now?*

PulsePrint explores a different approach: repeated smartphone-camera measurements establish an individual's recent physiological baseline, allowing later readings to be compared with that person's own pattern rather than a generic population value.

The research focus is not simply whether a phone camera can detect a pulse. It is whether repeated real-world smartphone PPG can support useful within-person deviation monitoring while refusing to interpret recordings that are not reliable enough.

## How it works

**Fingertip on camera + flash → optical PPG signal → quality check → signal processing → BPM estimate → personal baseline → deviation context**

The camera observes small changes in light absorption caused by blood-volume changes in the fingertip. PulsePrint samples the red-channel intensity from a central region of the camera feed, removes slow drift, smooths the resulting waveform, and estimates its dominant pulse period.

A second peak-based estimate is used as a cross-check. Recordings that are too short, dark, saturated, flat, poorly sampled, or insufficiently periodic are rejected rather than assigned a forced BPM value.

The first few seconds are excluded from analysis to allow mobile-camera exposure, focus, white balance and torch brightness to stabilize.

## Prototype features

- Rear-camera fingertip PPG capture
- Torch support where exposed by the browser/device
- Live waveform visualization
- Browser-side signal processing
- BPM estimation using autocorrelation and peak intervals
- Signal-quality scoring and rejection
- Recent valid reading history
- Personal baseline after repeated measurements
- Within-baseline / outside-baseline context
- On-device storage with no account required
- Mobile-first interface

## Privacy by design

PulsePrint performs the measurement pipeline locally in the browser. Camera frames, waveform samples and readings are not uploaded to a server. Valid recent readings are stored only in the browser's local storage for baseline calculation.

## Technology

PulsePrint is built with Next.js, React and TypeScript. It uses the browser MediaDevices API for camera capture, Canvas for optical sampling and waveform rendering, and a lightweight custom signal-processing pipeline for filtering, periodicity analysis and BPM estimation.

No backend, database, external API or language model is required for the prototype.

## Signal quality

Smartphone PPG is sensitive to motion, fingertip pressure, ambient light, hand temperature, camera hardware, automatic image processing, skin pigmentation and sensor saturation.

For that reason, signal quality is treated as part of the product rather than an afterthought. PulsePrint is designed to abstain when a recording is unreliable instead of presenting an apparently precise but unsupported result.

The prototype is being tested across real-device conditions to understand the trade-off between rejecting too many usable measurements and accepting signals that are too noisy.

## Personal baseline

After multiple valid measurements, PulsePrint creates a simple range from recent readings stored on the device. A new measurement can then be described relative to that recent personal context.

This baseline is **not** a clinical reference range. It is an experimental demonstration of within-person comparison.

## Hack2Heal 2.0

PulsePrint was developed for Hack2Heal 2.0 as a proof of concept for individualized smartphone-camera PPG monitoring.

The next validation stage would compare smartphone measurements against reference pulse oximetry or ECG where available, measure repeatability and false-alert rates, and evaluate signal acceptance/rejection across different devices, recording conditions and skin-tone groups.

## Safety and limitations

PulsePrint has not been clinically validated and must not be used to diagnose, treat or rule out a medical condition. The displayed pulse estimate and baseline are experimental prototype outputs.

Stop a measurement if the phone or flash becomes uncomfortably warm.
