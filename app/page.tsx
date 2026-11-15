"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { rocketFacts, type FactStatus, type RocketFact } from "@/data/rocket-facts";
import { get_flight_stats, type FlightData, type FlightProvenance, type FlightStats, type LaunchType, type StatsWindow, type MissingDataRange } from "@/lib/flightStats";

const RocketModelPanel = dynamic(() => import("./RocketModelPanel"), { ssr: false });

type Message = {
  id: number;
  role: "bot" | "user";
  text: string;
  stats?: FlightStats;
};

const noFlightQuestions = [
  "How does a water rocket work?",
  "What are the safety rules?",
  "How does stability work?",
  "Why is it called AngleOfAttack?",
  "What does our rocket measure?",
  "How do I load flight data?",
];

const loadedFlightQuestions = [
  "What was our peak acceleration?",
  "How long was the burn?",
  "Estimate our thrust and range",
  "Was the sensor clipped?",
  "Is this real data?",
  "What are the safety rules?",
];

const initialMessages: Message[] = [{
  id: 1,
  role: "bot",
  text: "Hi! Ask about TeamAOA's water rocket, or replay a test flight.",
}];

function AoaLogo() {
  return <Image src="/AOALogo.svg" alt="" width={202} height={146} aria-hidden="true" />;
}

function UnconfirmedTag({ status }: { status: FactStatus }) {
  return status === "unconfirmed" ? <span className="demo-tag">UNCONFIRMED</span> : null;
}

function provenanceLabel(provenance: FlightProvenance) {
  return provenance === "real" ? "REAL FLIGHT" : provenance === "demo" ? "DEMO DATA" : "UNVERIFIED SOURCE";
}

const launchTypeLabels: Record<LaunchType, string> = {
  launcher: "Launcher (pressurized)",
  hand_throw: "Hand throw",
  drop_test: "Drop test",
  other: "Other / unknown",
};

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3.2-8L4 4Zm3.2 8h7.1" /></svg>;
}

const requiredColumns = ["t_us", "ax", "ay", "az"] as const;

function parsePosition(error: SyntaxError) {
  const match = error.message.match(/position\s+(\d+)/i);
  return match ? ` (around character ${match[1]})` : "";
}

function validateFlightJson(text: string, metadata: {
  label: string;
  angle: number;
  pressure: number;
  water: number;
  provenance: FlightProvenance;
  launchType: LaunchType;
}) {
  if (!text.trim()) return { error: "Paste JSON first" };
  if (text.length > 5 * 1024 * 1024) return { error: "Flight data is too large. Maximum size is about 5 MB." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const parserError = error instanceof SyntaxError ? error : new SyntaxError("Invalid JSON");
    return { error: `Invalid JSON: ${parserError.message}${parsePosition(parserError)}` };
  }
  if (!parsed || typeof parsed !== "object") return { error: "Flight JSON must be an object." };
  const source = parsed as Record<string, unknown>;
  if (typeof source.flight_id !== "number" || !Number.isFinite(source.flight_id)) {
    return { error: "flight_id must be a finite number." };
  }
  const columns = source.columns;
  const samples = source.samples;
  if (!Array.isArray(columns) || !requiredColumns.every((column) => columns.includes(column))) {
    return { error: 'Required columns must include "t_us", "ax", "ay", and "az".' };
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    return { error: "samples must be a non-empty array of arrays." };
  }
  if (typeof source.sample_rate_hz !== "number" || !Number.isFinite(source.sample_rate_hz)
    || typeof source.range_g !== "number" || !Number.isFinite(source.range_g)) {
    return { error: "sample_rate_hz and range_g must be finite numbers." };
  }
  const indexes = Object.fromEntries(requiredColumns.map((column) => [column, columns.indexOf(column)]));
  const canonicalSamples: [number, number | null, number | null, number | null][] = [];
  const missingDataIndices: number[] = [];
  const restartTimes: number[] = [];
  let duplicateRowsRemoved = 0;
  let previousRawTime: number | null = null;
  let lastAdjustedTime: number | null = null;
  const sampleInterval = Number(source.sample_rate_hz) > 0
    ? 1_000_000 / Number(source.sample_rate_hz)
    : 0;
  const accelerationScale = source.units === "g" ? 9.80665 : 1;
  let timeOffset = 0;
  for (let rowIndex = 0; rowIndex < samples.length; rowIndex += 1) {
    if (!Array.isArray(samples[rowIndex])) return { error: `Row ${rowIndex} must be an array.` };
    const row = samples[rowIndex] as unknown[];
    if (row.length !== columns.length) return { error: `Row ${rowIndex} must contain exactly ${columns.length} values.` };
    const values = requiredColumns.map((column) => row[indexes[column]]);
    const rawTime = values[0];
    if (typeof rawTime !== "number" || !Number.isFinite(rawTime)) {
      return { error: `Row ${rowIndex} contains a non-numeric t_us value.` };
    }
    if (previousRawTime !== null && rawTime === previousRawTime) {
      duplicateRowsRemoved += 1;
      continue;
    }
    if (previousRawTime !== null && rawTime < previousRawTime) {
      timeOffset = (lastAdjustedTime ?? 0) + sampleInterval;
      restartTimes.push((rawTime + timeOffset) / 1_000_000);
    }
    const adjustedTime = rawTime + timeOffset;
    const axes = values.slice(1);
    if (!axes.every((item) => item === null || (typeof item === "number" && Number.isFinite(item)))) {
      return { error: `Row ${rowIndex} contains a non-numeric non-null sample value.` };
    }
    const isMissing = axes.some((item) => item === null)
      || axes.every((item) => item === 0);
    canonicalSamples.push([
      adjustedTime,
      axes[0] === null ? null : (axes[0] as number) * accelerationScale,
      axes[1] === null ? null : (axes[1] as number) * accelerationScale,
      axes[2] === null ? null : (axes[2] as number) * accelerationScale,
    ]);
    if (isMissing) missingDataIndices.push(canonicalSamples.length - 1);
    previousRawTime = rawTime;
    lastAdjustedTime = adjustedTime;
  }
  const missingDataRanges: MissingDataRange[] = [];
  for (const index of missingDataIndices) {
    const time = canonicalSamples[index][0] / 1_000_000;
    const previous = missingDataRanges[missingDataRanges.length - 1];
    if (previous && time - previous.endTime <= Math.max(sampleInterval / 1_000_000 * 1.5, 0.02)) {
      previous.endTime = time;
    } else {
      missingDataRanges.push({ startTime: time, endTime: time });
    }
  }
  const warnings: string[] = [];
  if (source.units === undefined) warnings.push("Units were missing; assumed m/s^2.");
  if (source.units === "g") warnings.push("Acceleration converted from g to m/s^2.");
  const spacings = canonicalSamples.slice(1).map((row, index) => row[0] - canonicalSamples[index][0]).filter((spacing) => spacing > 0).sort((a, b) => a - b);
  const medianSpacing = spacings.length ? spacings[Math.floor(spacings.length / 2)] : 0;
  if (medianSpacing && Math.abs(1_000_000 / medianSpacing - Number(source.sample_rate_hz)) / Number(source.sample_rate_hz) > 0.1) {
    warnings.push("Median sample spacing disagrees with sample_rate_hz by more than 10%.");
  }
  const restingSamples = canonicalSamples.filter((row) => row[1] !== null && row[2] !== null && row[3] !== null).slice(0, 20);
  const resting = restingSamples.reduce((sum, row) => sum + Math.hypot(row[1]!, row[2]!, row[3]!), 0) / Math.max(1, restingSamples.length);
  if (Math.abs(resting - 9.80665) / 9.80665 > 0.1) warnings.push("Resting magnitude is not within 10% of 9.81 m/s^2; check units or range.");
  if (canonicalSamples.length < 100) warnings.push(`Only ${canonicalSamples.length} samples; results may be limited.`);
  if (duplicateRowsRemoved) warnings.push(`${duplicateRowsRemoved} duplicate rows removed`);
  if (restartTimes.length) warnings.push(`${restartTimes.length} restarts`);
  if (missingDataIndices.length) {
    const percentage = (missingDataIndices.length / canonicalSamples.length * 100).toFixed(1);
    const finalTime = canonicalSamples[canonicalSamples.length - 1][0] / 1_000_000;
    const ranges = missingDataRanges.map((range) => range.startTime === range.endTime
      ? `${range.startTime.toFixed(2)} s`
      : range.endTime === finalTime
        ? `${range.startTime.toFixed(2)} s to the end`
        : `${range.startTime.toFixed(2)} to ${range.endTime.toFixed(2)} s`).join(", ");
    warnings.push(`${missingDataIndices.length} of ${canonicalSamples.length} samples (${percentage}%) are missing data and were excluded${ranges ? ` (${ranges})` : ""}`);
  }
  const longGaps = spacings.filter((spacing) => spacing > 20_000).length;
  if (longGaps) warnings.push(`${longGaps} gaps over 20 ms detected.`);
  const ignored = ["altitude", "pitch"].filter((column) => columns.includes(column));
  if (ignored.length) warnings.push(`${ignored.join(" and ")} column${ignored.length > 1 ? "s were" : " was"} ignored; the bot does not use ${ignored.join(" or ")}.`);
  return {
    flight: {
      flight_id: Number(source.flight_id),
      sample_rate_hz: Number(source.sample_rate_hz),
      range_g: Number(source.range_g),
      units: "m/s^2" as const,
      columns: [...requiredColumns] as ["t_us", "ax", "ay", "az"],
      samples: canonicalSamples as FlightData["samples"],
      missingDataIndices,
      missingDataRanges,
      restartTimes,
      duplicateRowsRemoved,
      totalRows: samples.length,
      date: new Date().toISOString().slice(0, 10),
      provenance: metadata.provenance,
      launchType: metadata.launchType,
      label: metadata.label || `Flight ${source.flight_id}`,
      launch: { angle_deg: metadata.angle, pressure_bar: metadata.pressure, water_ml: metadata.water },
    } as FlightData & { label: string },
    warnings,
  };
}

function FlightPanel({
  flight,
  stats,
  onPaste,
}: {
  flight: FlightData;
  stats?: FlightStats;
  onPaste: () => void;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleAxes, setVisibleAxes] = useState({ ax: false, ay: false, az: false });
  const [smoothDisplay, setSmoothDisplay] = useState(false);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<StatsWindow | undefined>();
  const samples = flight.samples.map(([t_us, ax, ay, az]) => ({
    time: t_us / 1_000_000,
    ax,
    ay,
    az,
    magnitude: ax === null || ay === null || az === null ? null : Math.hypot(ax, ay, az),
  }));
  const smoothedSamples = samples.map((sample, index) => {
    if (sample.magnitude === null) return sample;
    const window = samples.slice(Math.max(0, index - 1), Math.min(samples.length, index + 2));
    const validWindow = window.filter((item) => item.magnitude !== null);
    return { ...sample, magnitude: validWindow.reduce((sum, item) => sum + (item.magnitude ?? 0), 0) / validWindow.length };
  });
  const chartSamples = smoothDisplay ? smoothedSamples : samples;
  const renderedSamples = chartSamples.length > 5000
    ? chartSamples.filter((_, index) => index % Math.ceil(chartSamples.length / 5000) === 0)
    : chartSamples;
  const maxAcceleration = Math.max(...samples.map((item) => item.magnitude ?? 0), 1);
  const maxTime = Math.max(...samples.map((item) => item.time), 1);
  const limit = flight.range_g * 9.80665;
  const chartWidth = 520;
  const chartHeight = 210;
  const pad = 30;
  const rangeStart = zoom[0] * maxTime;
  const rangeEnd = zoom[1] * maxTime;
  const toX = (time: number) => pad + ((time - rangeStart) / Math.max(rangeEnd - rangeStart, 0.001)) * (chartWidth - pad * 1.5);
  const toY = (acceleration: number) => chartHeight - pad - (acceleration / Math.max(limit, maxAcceleration) * (chartHeight - pad * 1.7));
  const pathFor = (key: "magnitude" | "ax" | "ay" | "az") => renderedSamples
    .filter((item) => item.time >= rangeStart && item.time <= rangeEnd)
    .map((item, pointIndex, visibleSamples) => {
      const previous = visibleSamples[pointIndex - 1];
      const value = item[key];
      const restartBetween = previous && (flight.restartTimes ?? []).some((time) => time > previous.time && time <= item.time);
      if (value === null) return "M";
      const startsSegment = pointIndex === 0 || !previous || previous[key] === null || restartBetween;
      return `${startsSegment ? "M" : "L"} ${toX(item.time)} ${toY(value)}`;
    }).join(" ");
  const launchTime = stats?.launchTime?.value ?? 0;
  const burnoutTime = stats?.burnTime?.value && stats.launchTime?.value ? stats.launchTime.value + stats.burnTime.value : null;
  const playableSamples = samples.filter((sample) => sample.magnitude !== null);
  const nextPoint = playableSamples.find((item) => item.time >= currentTime) ?? playableSamples[playableSamples.length - 1];
  const previousPoint = playableSamples[playableSamples.indexOf(nextPoint) - 1] ?? nextPoint;
  const segmentLength = nextPoint.time - previousPoint.time;
  const segmentProgress = segmentLength === 0 ? 0 : (currentTime - previousPoint.time) / segmentLength;
  const point = {
    time: currentTime,
    ax: (previousPoint.ax ?? 0) + ((nextPoint.ax ?? 0) - (previousPoint.ax ?? 0)) * segmentProgress,
    ay: (previousPoint.ay ?? 0) + ((nextPoint.ay ?? 0) - (previousPoint.ay ?? 0)) * segmentProgress,
    az: (previousPoint.az ?? 0) + ((nextPoint.az ?? 0) - (previousPoint.az ?? 0)) * segmentProgress,
    magnitude: (previousPoint.magnitude ?? 0) + ((nextPoint.magnitude ?? 0) - (previousPoint.magnitude ?? 0)) * segmentProgress,
  };
  const pointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return rangeStart + (fraction * (rangeEnd - rangeStart));
  };
  const displayedStats = selectedWindow
    ? get_flight_stats(flight.flight_id, flight, selectedWindow)
    : stats;

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let previous = performance.now();
    const advance = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;
      setCurrentTime((time) => {
        const nextTime = time + elapsed;
        if (nextTime >= maxTime) {
          setIsPlaying(false);
          return maxTime;
        }
        return nextTime;
      });
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, maxTime]);

  return (
    <div className="flight-panel" id="flight-panel">
      <div className="flight-heading">
        <div><p className="eyebrow">FLIGHT TELEMETRY</p><h2>{flight.label ?? `Flight ${flight.flight_id}`} <span className="launch-type-tag">{launchTypeLabels[flight.launchType]}</span></h2></div>
        <span className={`provenance-pill ${flight.provenance}`}>{provenanceLabel(flight.provenance)}</span>
      </div>
      <div className="flight-actions"><button type="button" onClick={onPaste}>Paste data</button><button type="button" onClick={() => setZoom([0, 1])}>Reset zoom</button><button type="button" onClick={() => { const span = zoom[1] - zoom[0]; setZoom([Math.max(0, zoom[0] - span * .25), Math.max(span, zoom[1] - span * .25)]); }}>Pan left</button><button type="button" onClick={() => { const span = zoom[1] - zoom[0]; setZoom([Math.min(1 - span, zoom[0] + span * .25), Math.min(1, zoom[1] + span * .25)]); }}>Pan right</button></div>
      <div className="axis-toggles">{(["ax", "ay", "az"] as const).map((axis) => <label key={axis}><input type="checkbox" checked={visibleAxes[axis]} onChange={() => setVisibleAxes((current) => ({ ...current, [axis]: !current[axis] }))} /> {axis}</label>)}</div>
      <label className="smooth-toggle"><input type="checkbox" checked={smoothDisplay} onChange={(event) => setSmoothDisplay(event.target.checked)} /> Smooth display (3 samples)</label>
      <svg className="flight-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Acceleration magnitude over time for flight ${flight.flight_id}`} onPointerMove={(event) => { if (dragStart === null) setCurrentTime(pointFromEvent(event)); }} onPointerDown={(event) => setDragStart(pointFromEvent(event))} onPointerUp={(event) => { if (dragStart !== null) { const end = pointFromEvent(event); const start = Math.min(dragStart, end); const finish = Math.max(dragStart, end); if (finish - start > maxTime * 0.02) { setSelectedWindow({ startTime: start, endTime: finish }); setZoom([0, 1]); } } setDragStart(null); }}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={pad} x2={chartWidth - pad / 2} y1={toY(Math.max(limit, maxAcceleration) * fraction)} y2={toY(Math.max(limit, maxAcceleration) * fraction)} className="chart-grid" />
        ))}
        <line x1={pad} x2={chartWidth - pad / 2} y1={toY(limit)} y2={toY(limit)} className="sensor-limit" />
        {stats?.freeFallStart?.value !== null && stats?.freeFallStart && <rect x={toX(stats.freeFallStart.value)} y={14} width={Math.max(1, toX(stats.impactTime?.value ?? stats.freeFallStart.value) - toX(stats.freeFallStart.value))} height={chartHeight - pad - 14} className="free-fall-window" />}
        <line x1={toX(launchTime)} x2={toX(launchTime)} y1={14} y2={chartHeight - pad} className="flight-marker" />
        {stats?.impactTime?.value !== null && stats?.impactTime && <line x1={toX(stats.impactTime.value)} x2={toX(stats.impactTime.value)} y1={14} y2={chartHeight - pad} className="impact-marker" />}
        {burnoutTime !== null && <line x1={toX(burnoutTime)} x2={toX(burnoutTime)} y1={14} y2={chartHeight - pad} className="flight-marker" />}
        {(flight.restartTimes ?? []).filter((time) => time >= rangeStart && time <= rangeEnd).map((time) => (
          <g key={`restart-${time}`}>
            <line x1={toX(time)} x2={toX(time)} y1={14} y2={chartHeight - pad} className="flight-marker" />
            <text x={toX(time) + 3} y={25}>ESP restart</text>
          </g>
        ))}
        <path d={pathFor("magnitude")} className="acceleration-line" />
        {visibleAxes.ax && <path d={pathFor("ax")} className="axis-line axis-x" />}
        {visibleAxes.ay && <path d={pathFor("ay")} className="axis-line axis-y" />}
        {visibleAxes.az && <path d={pathFor("az")} className="axis-line axis-z" />}
        {renderedSamples.filter((item) => item.time >= rangeStart && item.time <= rangeEnd && (item.magnitude ?? 0) >= limit).map((item) => (
          <circle key={item.time} cx={toX(item.time)} cy={toY(item.magnitude ?? 0)} r="2.5" className="clipped-sample" />
        ))}
        <circle cx={toX(currentTime)} cy={toY(point.magnitude)} r="5" className="playback-marker" />
        <text x={pad} y={chartHeight - 7}>0 s</text>
        <text x={chartWidth - pad / 2} y={chartHeight - 7} textAnchor="end">{rangeEnd.toFixed(1)} s</text>
        <text x={pad} y={16}>{Math.max(limit, maxAcceleration).toFixed(0)} m/s²</text>
      </svg>
      <input className="scrubber" type="range" min="0" max={maxTime} step="0.01" value={currentTime} onChange={(event) => { setCurrentTime(Number(event.target.value)); setIsPlaying(false); }} aria-label="Scrub flight playback" />
      <div className="flight-controls">
        <button type="button" onClick={() => { if (currentTime >= maxTime) setCurrentTime(0); setIsPlaying((playing) => !playing); }} aria-label={isPlaying ? "Pause flight playback" : "Play flight playback"}>{isPlaying ? "Ⅱ" : "▶"}</button>
        <span>{isPlaying ? "Playing" : "Paused"}</span>
      </div>
      <div className="flight-readouts" title="Hover the chart to inspect the nearest sample">
        <div><span>TIME</span><strong>{point.time.toFixed(3)} s</strong></div>
        <div><span>AX</span><strong>{point.ax.toFixed(2)} m/s²</strong></div>
        <div><span>AY</span><strong>{point.ay.toFixed(2)} m/s²</strong></div>
        <div><span>AZ</span><strong>{point.az.toFixed(2)} m/s²</strong></div>
        <div><span>|A|</span><strong>{point.magnitude.toFixed(2)} m/s²</strong></div>
      </div>
      {displayedStats && <><div className="stats-table">{(["restingMagnitude", "magnitude", "freeFallStart", "releaseAcceleration", "impactTime", "impactAcceleration", "roughApogee", "burnTime", "peakAcceleration", "flightTime", "launchSpeed", "peakThrust", "impulse", "estimatedRange"] as const).map((key) => {
        const stat = displayedStats[key];
        return <div className="stat-row" key={key} title={stat?.note ?? displayedStats.reason}><span>{key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}</span><strong>{stat?.value === null || !stat ? stat?.note ?? "Not detected" : `${typeof stat.value === "number" ? stat.value.toFixed(2) : stat.value} ${stat.unit}`}</strong><em>{stat?.label ?? "estimated"}</em></div>;
      })}</div><div className="range-arc"><svg viewBox="0 0 220 70" role="img" aria-label="Estimated projectile arc"><path d="M10 58 Q 110 0 210 58" /><line x1="10" y1="58" x2="210" y2="58" /><text x="110" y="68" textAnchor="middle">Estimated, ignores drag</text></svg></div></>}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightData | null>(null);
  const [selectedStats, setSelectedStats] = useState<FlightStats | undefined>();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  const [flightLabel, setFlightLabel] = useState("Pasted flight");
  const [launchAngle, setLaunchAngle] = useState("");
  const [launchPressure, setLaunchPressure] = useState("");
  const [waterVolume, setWaterVolume] = useState("");
  const [pasteProvenance, setPasteProvenance] = useState<FlightProvenance>("unverified");
  const [launchType, setLaunchType] = useState<LaunchType>("other");
  const [saveToBrowser, setSaveToBrowser] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nextMessageId = useRef(2);
  const flightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const selectFlight = (flightId?: number, flight?: FlightData, stats?: FlightStats) => {
    const chosen = flight ?? flights.find((item) => item.flight_id === flightId);
    if (chosen) {
      setSelectedFlight(chosen);
      setSelectedStats(stats ?? get_flight_stats(chosen.flight_id, chosen));
      window.setTimeout(() => flightPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("aoabot-flights") ?? "[]") as FlightData[];
      if (Array.isArray(saved) && saved.length) {
        const normalized = saved.map((flight) => ({ ...flight, launchType: flight.launchType ?? "other" }));
        window.setTimeout(() => setFlights((current) => [...current, ...normalized]), 0);
      }
    } catch {
      window.setTimeout(() => setPasteError("Saved browser flight data could not be read."), 0);
    }
  }, []);

  function openPaste() {
    setPasteOpen(true);
    setPasteError("");
    setPasteWarnings([]);
  }

  function readFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setPasteError("Flight data is too large. Maximum size is about 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPasteText(String(reader.result ?? ""));
    reader.onerror = () => setPasteError("Could not read that file.");
    reader.readAsText(file);
  }

  function loadPastedFlight() {
    const result = validateFlightJson(pasteText, {
      label: flightLabel.trim(),
      angle: Number(launchAngle),
      pressure: Number(launchPressure),
      water: Number(waterVolume),
      provenance: pasteProvenance,
      launchType,
    });
    if (result.error || !result.flight) {
      setPasteError(result.error ?? "Could not load flight data.");
      return;
    }
    const existing = flights.find((flight) => flight.flight_id === result.flight.flight_id);
    let flight = result.flight;
    if (existing && !window.confirm(`Flight ${flight.flight_id} already exists. Press OK to replace it, or Cancel to keep both.`)) {
      const nextId = Math.max(0, ...flights.map((item) => item.flight_id)) + 1;
      flight = { ...flight, flight_id: nextId, label: `${flight.label} (copy)` };
    }
    setFlights((current) => [...current.filter((item) => item.flight_id !== flight.flight_id), flight]);
    if (saveToBrowser) {
      try {
        const saved = [...flights.filter((item) => item.flight_id !== flight.flight_id), flight];
        localStorage.setItem("aoabot-flights", JSON.stringify(saved));
      } catch {
        setPasteError("Flight loaded, but could not be saved to this browser.");
      }
    }
    setSelectedFlight(flight);
    setSelectedStats(get_flight_stats(flight.flight_id, flight));
    setPasteWarnings(result.warnings ?? []);
    setPasteOpen(false);
    window.setTimeout(() => flightPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  function deleteSavedFlights() {
    try {
      localStorage.removeItem("aoabot-flights");
      setFlights([]);
      setSelectedFlight(null);
      setSelectedStats(undefined);
    } catch {
      setPasteError("Could not clear saved browser flights.");
    }
  }

  async function submit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    const userMessage = { id: nextMessageId.current++, role: "user" as const, text: trimmed };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-30).map(({ role, text }) => ({ role: role === "bot" ? "assistant" : "user", content: text })), flight: selectedFlight, flights }),
      });
      const result = await response.json() as { message?: string; error?: string; showSimulation?: { flightId?: number; flight?: FlightData }; flightStats?: FlightStats };
      if (!response.ok || !result.message) throw new Error(result.error ?? "AOABot could not answer right now.");
      selectFlight(result.showSimulation?.flightId, result.showSimulation?.flight, result.flightStats);
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        role: "bot",
        text: result.message!,
        stats: result.flightStats,
      }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function clearConversation() {
    if (isLoading) return;
    setMessages(initialMessages);
    nextMessageId.current = 2;
    setError("");
  }

  const snapshotFacts = useMemo(() => [
    ["BOTTLE", rocketFacts.bottle],
    ["NOSE CONE", rocketFacts.noseCone],
    ["OTHER PARTS", rocketFacts.otherParts],
    ["ELECTRONICS", rocketFacts.electronics],
    ["ELECTRONICS MASS", rocketFacts.electronicsMass],
  ] as ReadonlyArray<readonly [string, RocketFact<string | null>]>, []);

  return (
    <main className="app-shell">
      <section className="workspace" id="chat">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><AoaLogo /></div><strong>AOABot</strong></div>
          <div className="topbar-right"><span>TeamAOA · 2026</span><button className="clear-chat" onClick={clearConversation} disabled={isLoading}>Clear chat</button></div>
        </header>
        <div className="content-grid">
          <section className="chat-column">
            <div className="chat-heading"><h1>AOABot. Ask about TeamAOA&apos;s water rocket, or replay a test flight.</h1></div>
            <div className="messages" aria-live="polite" aria-busy={isLoading}>
              {messages.map((message) => (
                <div className={`message-row ${message.role} ${message.role === "bot" && /safety|goggles|pressur|authorized|rope/i.test(message.text) ? "safety-answer" : ""}`} key={message.id}>
                  {message.role === "bot" && <div className="tiny-avatar"><AoaLogo /></div>}
                  <div className="message-bubble"><p>{message.text}</p>{message.stats && <div className="computed-tag">Computed from flight {message.stats.flightId} · {provenanceLabel(message.stats.provenance).toLowerCase()}</div>}<time>{message.role === "bot" ? "AOABot" : "You"}</time></div>
                </div>
              ))}
              {isLoading && <div className="typing-indicator"><span /><span /><span /> Thinking…</div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="quick-ask"><p>TRY ASKING</p><div>{(selectedFlight
              ? flights.length >= 2
                ? loadedFlightQuestions.map((question) => question === "Is this real data?" ? "Compare my flights" : question)
                : loadedFlightQuestions
              : noFlightQuestions
            ).map((question) => <button key={question} onClick={() => submit(question)}>{question}</button>)}</div></div>
            <form className="composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit(input); }}>
              <input aria-label="Ask about the water rocket" maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question about our water rocket..." />
              <button aria-label="Send question" type="submit" disabled={isLoading}><SendIcon /></button>
            </form>
            {error && <p className="chat-error" role="alert">{error}</p>}
            <p className="disclaimer">Answers come from TeamAOA project data. Unconfirmed values are marked.</p>
          </section>
          <aside className="info-column">
            {snapshotFacts.some(([, fact]) => fact.status === "confirmed") && <div className="info-card snapshot"><div className="card-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Rocket snapshot</h2></div></div><div className="spec-grid">{snapshotFacts.filter(([, fact]) => fact.status === "confirmed").map(([label, fact]) => <div key={label}><span>{label}</span><strong>{fact.value}</strong><small>{fact.note}</small></div>)}</div></div>}
            <RocketModelPanel />
            <div ref={flightPanelRef}>{flights.length > 0 && <div className="flight-list">{flights.map((flight) => <button type="button" className={flight.flight_id === selectedFlight?.flight_id ? "selected" : ""} key={flight.flight_id} onClick={() => selectFlight(flight.flight_id)}>{flight.label ?? `Flight ${flight.flight_id}`} · {launchTypeLabels[flight.launchType]} · {provenanceLabel(flight.provenance)}</button>)}</div>}{selectedFlight ? <FlightPanel key={selectedFlight.flight_id} flight={selectedFlight} stats={selectedStats} onPaste={openPaste} /> : <div className="info-card no-flight">No flight loaded. Paste flight data.<button type="button" onClick={openPaste}>Paste data</button></div>}
              {pasteOpen && <div className="paste-panel">
                <h3>Paste flight data</h3>
                <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) readFile(file); }} placeholder='{"flight_id":2,"sample_rate_hz":200,"range_g":16,"units":"m/s^2","columns":["t_us","ax","ay","az"],"samples":[]}' />
                <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); }} />
                <button type="button" onClick={() => fileInputRef.current?.click()}>Choose .json file</button>
                <div className="paste-fields">
                  <label>Flight label<input value={flightLabel} onChange={(event) => setFlightLabel(event.target.value)} /></label>
                  <label>Launch type<select required value={launchType} onChange={(event) => setLaunchType(event.target.value as LaunchType)}><option value="launcher">Launcher (pressurized)</option><option value="hand_throw">Hand throw</option><option value="drop_test">Drop test</option><option value="other">Other / unknown</option></select></label>
                  <label>Launch angle entered for this flight (deg)<input value={launchAngle} onChange={(event) => setLaunchAngle(event.target.value)} /> <UnconfirmedTag status={rocketFacts.launchAngle_deg.status} /></label>
                  <label>Launch pressure entered for this flight (bar)<input value={launchPressure} onChange={(event) => setLaunchPressure(event.target.value)} /> <UnconfirmedTag status={rocketFacts.launchPressure_bar.status} /></label>
                  <label>Water volume entered for this flight (mL)<input value={waterVolume} onChange={(event) => setWaterVolume(event.target.value)} /> <UnconfirmedTag status={rocketFacts.waterVolume_ml.status} /></label>
                </div>
                <label className="paste-toggle">Source label<select value={pasteProvenance} onChange={(event) => setPasteProvenance(event.target.value as FlightProvenance)}><option value="unverified">Unverified source</option><option value="demo">Demo data</option><option value="real">Real flight</option></select></label>
                <label className="paste-toggle"><input type="checkbox" checked={saveToBrowser} onChange={(event) => setSaveToBrowser(event.target.checked)} /> Save to this browser</label>
                <div className="paste-actions"><button type="button" onClick={loadPastedFlight}>Load</button><button type="button" onClick={() => setPasteOpen(false)}>Cancel</button><button type="button" onClick={deleteSavedFlights}>Clear saved</button></div>
                {pasteError && <p className="chat-error" role="alert">{pasteError}</p>}
                {pasteWarnings.map((warning) => <p className="paste-warning" key={warning}>{warning}</p>)}
              </div>}
              {!pasteOpen && pasteWarnings.map((warning) => <p className="paste-warning" key={warning}>{warning}</p>)}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
