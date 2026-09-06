"use client";

import {
  Activity,
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronRight,
  HeartPulse,
  History,
  Lightbulb,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { analyzePpg } from "@/lib/signal";
import { calculateBaseline, clearReadings, loadReadings, saveReading } from "@/lib/storage";
import type { Baseline, PpgSample, SignalAnalysis, StoredReading } from "@/lib/types";

const MEASUREMENT_SECONDS = 24;
const TARGET_SAMPLE_INTERVAL = 1000 / 30;
const CHART_POINTS = 220;

type Phase = "idle" | "requesting" | "measuring" | "processing" | "complete" | "error";

function formatReadingTime(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(isoDate));
}

function qualityLabel(analysis: SignalAnalysis | null): string {
  if (!analysis) return "Waiting";
  if (analysis.quality === "good") return "Good signal";
  if (analysis.quality === "fair") return "Fair signal";
  return "Reading rejected";
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera access was blocked. Allow camera permission for this site, then try again.";
    }
    if (error.name === "NotFoundError") {
      return "No rear camera was found. Open PulsePrint on a camera-equipped phone.";
    }
    if (error.name === "NotReadableError") {
      return "The camera is busy in another app. Close it there, then try again.";
    }
  }

  return "The camera could not start. Check permission, close other camera apps, and retry.";
}

function drawWaveform(canvas: HTMLCanvasElement | null, source: number[]): void {
  if (!canvas) return;

  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;

  const styles = getComputedStyle(canvas);
  const gridColor = styles.getPropertyValue("--wave-grid").trim();
  const waveColor = styles.getPropertyValue("--wave").trim();
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.lineWidth = pixelRatio;
  context.strokeStyle = gridColor;
  context.beginPath();

  for (let row = 1; row < 4; row += 1) {
    const y = (targetHeight * row) / 4;
    context.moveTo(0, y);
    context.lineTo(targetWidth, y);
  }
  context.stroke();

  const values = source.slice(-CHART_POINTS);
  if (values.length < 2) {
    context.strokeStyle = waveColor;
    context.lineWidth = 2 * pixelRatio;
    context.beginPath();
    context.moveTo(0, targetHeight / 2);
    context.lineTo(targetWidth, targetHeight / 2);
    context.stroke();
    return;
  }

  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const center = (low + high) / 2;
  const range = Math.max(0.08, high - low);
  const horizontalStep = targetWidth / Math.max(1, values.length - 1);

  context.strokeStyle = waveColor;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.25 * pixelRatio;
  context.beginPath();
  values.forEach((value, index) => {
    const x = index * horizontalStep;
    const normalized = (value - center) / range;
    const y = targetHeight / 2 - normalized * targetHeight * 0.72;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function baselineCopy(baseline: Baseline | null, bpm: number | null): string {
  if (!baseline || bpm === null) return "Complete three valid readings to compare against your baseline.";
  if (bpm >= baseline.low && bpm <= baseline.high) return "This reading is within your usual range.";
  return "This reading is outside your usual range. Rest, keep conditions steady, and repeat once.";
}

export function PulsePrintApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const samplingRef = useRef(false);
  const samplesRef = useRef<PpgSample[]>([]);
  const startTimeRef = useRef(0);
  const lastSampleTimeRef = useRef(0);
  const lastUiTimeRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [liveHint, setLiveHint] = useState("Place your fingertip gently over the rear camera and flash.");
  const [torchAvailable, setTorchAvailable] = useState<boolean | null>(null);
  const [readings, setReadings] = useState<StoredReading[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [comparisonBaseline, setComparisonBaseline] = useState<Baseline | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const initializationFrame = requestAnimationFrame(() => {
      setReadings(loadReadings());
      setHistoryReady(true);
      drawWaveform(waveformRef.current, []);
    });

    return () => {
      cancelAnimationFrame(initializationFrame);
      samplingRef.current = false;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const baseline = useMemo(() => calculateBaseline(readings), [readings]);
  const progress = Math.min(100, (elapsed / MEASUREMENT_SECONDS) * 100);
  const isBusy = phase === "requesting" || phase === "measuring" || phase === "processing";

  function stopCamera(): void {
    samplingRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function sampleFrame(video: HTMLVideoElement): PpgSample | null {
    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = captureCanvasRef.current ?? document.createElement("canvas");
    captureCanvasRef.current = canvas;
    canvas.width = 40;
    canvas.height = 40;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    const sourceSize = Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.24);
    const sourceX = Math.floor((video.videoWidth - sourceSize) / 2);
    const sourceY = Math.floor((video.videoHeight - sourceSize) / 2);
    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 40, 40);
    const pixels = context.getImageData(0, 0, 40, 40).data;
    let red = 0;
    let green = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      red += pixels[index];
      green += pixels[index + 1];
    }

    const pixelCount = pixels.length / 4;
    const redMean = red / pixelCount;
    const greenMean = green / pixelCount;

    return {
      time: (performance.now() - startTimeRef.current) / 1000,
      red: redMean,
      green: greenMean,
      value: redMean,
    };
  }

  function completeMeasurement(captured: PpgSample[]): void {
    setPhase("processing");
    stopCamera();

    window.requestAnimationFrame(() => {
      const result = analyzePpg(captured);
      const previousReadings = loadReadings();
      const priorBaseline = calculateBaseline(previousReadings);
      setAnalysis(result);
      setComparisonBaseline(priorBaseline);
      drawWaveform(waveformRef.current, result.filtered);

      if (result.valid && result.bpm !== null) {
        const reading: StoredReading = {
          bpm: result.bpm,
          id: crypto.randomUUID(),
          quality: result.quality === "good" ? "good" : "fair",
          qualityScore: result.qualityScore,
          recordedAt: new Date().toISOString(),
          sampleRate: Math.round(result.sampleRate),
        };
        setReadings(saveReading(reading));
      }

      setPhase("complete");
    });
  }

  async function startMeasurement(): Promise<void> {
    setErrorMessage("");
    setAnalysis(null);
    setComparisonBaseline(null);
    setElapsed(0);
    setTorchAvailable(null);
    setLiveHint("Starting the rear camera…");
    drawWaveform(waveformRef.current, []);

    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setErrorMessage("Camera access requires HTTPS. Open the deployed secure URL and retry.");
      setPhase("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("This browser does not support camera capture. Use a recent mobile Chrome browser.");
      setPhase("error");
      return;
    }

    setPhase("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          frameRate: { ideal: 30, max: 60 },
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.();
      const canUseTorch = Boolean(capabilities?.torch);
      setTorchAvailable(canUseTorch);

      if (canUseTorch) {
        try {
          await track.applyConstraints({ advanced: [{ torch: true }] });
        } catch {
          setTorchAvailable(false);
        }
      }

      samplesRef.current = [];
      startTimeRef.current = performance.now();
      lastSampleTimeRef.current = 0;
      lastUiTimeRef.current = 0;
      samplingRef.current = true;
      setPhase("measuring");
      setLiveHint("Cover the camera and flash, then hold completely still.");

      const tick = (now: number) => {
        if (!samplingRef.current) return;

        const currentElapsed = (now - startTimeRef.current) / 1000;
        if (now - lastSampleTimeRef.current >= TARGET_SAMPLE_INTERVAL) {
          const sample = sampleFrame(video);
          if (sample) {
            samplesRef.current.push(sample);
            lastSampleTimeRef.current = now;
            drawWaveform(
              waveformRef.current,
              samplesRef.current.map((item) => item.value),
            );

            if (now - lastUiTimeRef.current >= 250) {
              setElapsed(currentElapsed);
              const recent = samplesRef.current.slice(-45);
              const recentMean =
                recent.reduce((sum, item) => sum + item.red, 0) / Math.max(1, recent.length);
              if (recentMean < 55) {
                setLiveHint("Cover the camera and flash completely.");
              } else if (recentMean > 250) {
                setLiveHint("Ease the pressure slightly and keep still.");
              } else {
                setLiveHint("Good coverage. Keep your hand relaxed and still.");
              }
              lastUiTimeRef.current = now;
            }
          }
        }

        if (currentElapsed >= MEASUREMENT_SECONDS) {
          samplingRef.current = false;
          setElapsed(MEASUREMENT_SECONDS);
          completeMeasurement(samplesRef.current.slice());
          return;
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    } catch (error) {
      stopCamera();
      setErrorMessage(cameraErrorMessage(error));
      setPhase("error");
    }
  }

  function cancelMeasurement(): void {
    stopCamera();
    setElapsed(0);
    setAnalysis(null);
    setErrorMessage("");
    setLiveHint("Place your fingertip gently over the rear camera and flash.");
    setPhase("idle");
    drawWaveform(waveformRef.current, []);
  }

  function handleClearHistory(): void {
    clearReadings();
    setReadings([]);
    setComparisonBaseline(null);
    setConfirmClear(false);
  }

  return (
    <main className="min-h-dvh bg-background px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-foreground sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <a className="focus-ring flex min-h-11 items-center gap-3 rounded-xl" href="#main-content" aria-label="PulsePrint home">
            <span className="relative grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <HeartPulse className="size-5" aria-hidden="true" />
              <span className="status-pulse absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-signal" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">PulsePrint</span>
              <span className="block text-xs text-muted-foreground">Personal pulse baseline</span>
            </span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />
            On-device
          </span>
        </header>

        <div id="main-content" className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(19rem,0.7fr)]">
          <section aria-labelledby="measure-title" className="overflow-hidden rounded-3xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-5 sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Camera PPG</p>
                  <h1 id="measure-title" className="mt-2 max-w-xl text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                    Your pulse, compared with you.
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Use the rear camera and flash for a {MEASUREMENT_SECONDS}-second fingertip reading. Processing stays in this browser.
                  </p>
                </div>
                <ShieldCheck className="hidden size-7 shrink-0 text-primary sm:block" aria-hidden="true" />
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-7">
              <div className="camera-stage relative aspect-[4/3] overflow-hidden rounded-2xl bg-camera">
                <video
                  ref={videoRef}
                  className={`size-full object-cover ${phase === "measuring" || phase === "requesting" ? "opacity-100" : "opacity-0"}`}
                  autoPlay
                  muted
                  playsInline
                />
                {phase !== "measuring" && phase !== "requesting" ? (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center">
                    <div className="max-w-xs">
                      <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-camera-border bg-camera-panel text-camera-foreground">
                        <Camera className="size-6" aria-hidden="true" />
                      </span>
                      <p className="mt-4 text-sm font-medium text-camera-foreground">Rear camera preview</p>
                      <p className="mt-1 text-xs leading-5 text-camera-muted">Nothing is recorded, uploaded, or stored as video.</p>
                    </div>
                  </div>
                ) : null}

                {phase === "measuring" ? (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                    <div className="finger-guide grid size-32 place-items-center rounded-full sm:size-40">
                      <span className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-camera-foreground">Cover here</span>
                    </div>
                  </div>
                ) : null}

                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-camera-overlay px-3 py-2 text-xs font-medium text-camera-foreground backdrop-blur-sm">
                  <span className={`size-2 rounded-full ${phase === "measuring" ? "status-pulse bg-signal" : "bg-camera-muted"}`} aria-hidden="true" />
                  {phase === "measuring" ? "Measuring" : phase === "requesting" ? "Starting camera" : "Camera off"}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-subtle p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Activity className="size-4 text-primary" aria-hidden="true" />
                    Live PPG waveform
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {phase === "measuring" ? `${Math.ceil(MEASUREMENT_SECONDS - elapsed)}s left` : qualityLabel(analysis)}
                  </span>
                </div>
                <canvas
                  ref={waveformRef}
                  className="waveform mt-3 h-28 w-full"
                  role="img"
                  aria-label="Camera intensity waveform. A clear repeating pattern may indicate a usable pulse signal."
                >
                  Live camera intensity waveform.
                </canvas>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-progress-track" role="progressbar" aria-label="Measurement progress" aria-valuemin={0} aria-valuemax={MEASUREMENT_SECONDS} aria-valuenow={Math.round(elapsed)}>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <p className="text-xs leading-5 text-muted-foreground">{liveHint}</p>
                  {torchAvailable !== null && phase === "measuring" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Lightbulb className="size-3.5" aria-hidden="true" />
                      Flash {torchAvailable ? "on" : "unavailable"}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="sr-only" aria-live="polite">
                {phase === "requesting" ? "Requesting camera permission." : null}
                {phase === "measuring" ? "Measurement in progress." : null}
                {phase === "processing" ? "Processing the signal on this device." : null}
                {phase === "complete" ? "Measurement complete." : null}
              </div>

              {phase === "error" ? (
                <div className="state-error" role="alert">
                  <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">Couldn’t start a reading</p>
                    <p className="mt-1 text-sm leading-6">{errorMessage}</p>
                  </div>
                </div>
              ) : null}

              {phase === "complete" && analysis ? (
                <div className={analysis.valid ? "state-success" : "state-warning"} role="status">
                  {analysis.valid ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{analysis.valid ? "Usable reading" : "Reading rejected"}</p>
                    <p className="mt-1 text-sm leading-6">{analysis.reason}</p>
                    {analysis.valid && analysis.bpm !== null ? (
                      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-4xl font-semibold tracking-[-0.04em] tabular-nums">{analysis.bpm}</span>
                          <span className="text-sm font-medium">BPM</span>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.12em] opacity-75">Signal quality</p>
                          <p className="mt-1 text-sm font-semibold capitalize">{analysis.quality} · {analysis.qualityScore}%</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                {phase === "measuring" || phase === "requesting" ? (
                  <button className="button-secondary w-full sm:flex-1" type="button" onClick={cancelMeasurement}>
                    <Square className="size-4 fill-current" aria-hidden="true" />
                    Stop measurement
                  </button>
                ) : (
                  <button className="button-primary w-full sm:flex-1" type="button" onClick={() => void startMeasurement()} disabled={isBusy} aria-busy={isBusy}>
                    {phase === "processing" ? (
                      <Activity className="size-4" aria-hidden="true" />
                    ) : phase === "complete" || phase === "error" ? (
                      <RotateCcw className="size-4" aria-hidden="true" />
                    ) : (
                      <Camera className="size-4" aria-hidden="true" />
                    )}
                    {phase === "processing" ? "Analyzing signal…" : phase === "complete" || phase === "error" ? "Measure again" : "Start measurement"}
                  </button>
                )}
              </div>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                Prototype only — not a medical diagnosis. Stop if the flash or camera feels uncomfortably warm.
              </p>
            </div>
          </section>

          <aside className="space-y-6">
            <section aria-labelledby="baseline-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Personal context</p>
                  <h2 id="baseline-title" className="mt-2 text-lg font-semibold tracking-tight">Your baseline</h2>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                  <HeartPulse className="size-5" aria-hidden="true" />
                </span>
              </div>

              {baseline ? (
                <div className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{baseline.low}–{baseline.high}</span>
                    <span className="text-sm font-medium text-muted-foreground">BPM</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Typical range from your recent valid readings on this device.</p>
                  {analysis?.valid ? (
                    <div className="mt-4 rounded-xl bg-subtle p-3 text-sm leading-6">
                      {baselineCopy(comparisonBaseline, analysis.bpm)}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-6 rounded-2xl bg-subtle p-4">
                  <p className="text-sm font-medium">Baseline is still learning</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {readings.length === 0 ? "Your first valid reading will start the baseline." : "One more valid reading will create an initial range."}
                  </p>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                <span>{readings.length}/5 readings saved</span>
                <span>Local only</span>
              </div>
            </section>

            <section aria-labelledby="history-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <History className="size-4 text-primary" aria-hidden="true" />
                  <h2 id="history-title" className="text-sm font-semibold">Recent readings</h2>
                </div>
                {readings.length > 0 && !confirmClear ? (
                  <button className="focus-ring grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground" type="button" onClick={() => setConfirmClear(true)} aria-label="Clear recent readings">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {confirmClear ? (
                <div className="mt-4 rounded-2xl border border-danger-border bg-danger-soft p-4">
                  <p className="text-sm font-semibold text-danger">Clear local history?</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">This removes the five saved readings used for your baseline.</p>
                  <div className="mt-3 flex gap-2">
                    <button className="button-danger flex-1" type="button" onClick={handleClearHistory}>Clear</button>
                    <button className="button-quiet flex-1" type="button" onClick={() => setConfirmClear(false)}>
                      <X className="size-4" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {!historyReady ? (
                <div className="mt-4 space-y-3" aria-label="Loading recent readings">
                  <div className="skeleton h-14 rounded-xl" />
                  <div className="skeleton h-14 rounded-xl" />
                </div>
              ) : readings.length === 0 ? (
                <div className="mt-5 py-5 text-center">
                  <span className="mx-auto grid size-11 place-items-center rounded-xl bg-subtle text-muted-foreground">
                    <Activity className="size-5" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-medium">No readings yet</p>
                  <p className="mx-auto mt-1 max-w-56 text-xs leading-5 text-muted-foreground">Complete a usable measurement to begin your private history.</p>
                </div>
              ) : (
                <ol className="mt-4 space-y-2">
                  {readings.map((reading) => (
                    <li className="flex items-center justify-between gap-4 rounded-xl bg-subtle px-3 py-3" key={reading.id}>
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-lg font-semibold tabular-nums">{reading.bpm}</span>
                          <span className="text-xs text-muted-foreground">BPM</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatReadingTime(reading.recordedAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span className="text-xs font-medium capitalize text-muted-foreground">{reading.quality}</span>
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-3xl bg-primary p-5 text-primary-foreground sm:p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold">Built to abstain</h2>
                  <p className="mt-1 text-sm leading-6 text-primary-muted">
                    Motion, pressure, lighting, and different cameras affect optical readings. PulsePrint rejects weak signals instead of inventing a number.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
