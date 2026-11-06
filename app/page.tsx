"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Image from "next/image";
import demoFlight from "@/data/flights/demo-synthetic.json";
import { rocketFacts, type FactStatus, type RocketFact } from "@/data/rocket-facts";
import { get_flight_stats, type FlightData, type FlightStats } from "@/lib/flightStats";

type Message = {
  id: number;
  role: "bot" | "user";
  text: string;
  stats?: FlightStats;
};

const quickQuestions = [
  "Show flight 2",
  "What was our peak acceleration?",
  "How long was the burn?",
  "Estimate our thrust and range",
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

function DemoTag({ status }: { status: FactStatus }) {
  return status === "demo" ? <span className="demo-tag">DEMO</span> : null;
}

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
  isDemoData: boolean;
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
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every(Array.isArray)) {
    return { error: "samples must be a non-empty array of arrays." };
  }
  if (typeof source.sample_rate_hz !== "number" || !Number.isFinite(source.sample_rate_hz)
    || typeof source.range_g !== "number" || !Number.isFinite(source.range_g)) {
    return { error: "sample_rate_hz and range_g must be finite numbers." };
  }
  const indexes = Object.fromEntries(requiredColumns.map((column) => [column, columns.indexOf(column)]));
  const canonicalSamples: [number, number, number, number][] = [];
  for (let rowIndex = 0; rowIndex < samples.length; rowIndex += 1) {
    const row = samples[rowIndex] as unknown[];
    if (row.length !== columns.length) return { error: `Row ${rowIndex} must contain exactly ${columns.length} values.` };
    const values = requiredColumns.map((column) => row[indexes[column]]);
    if (!values.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return { error: `Row ${rowIndex} contains a non-finite sample value.` };
    }
    if (rowIndex > 0 && (values[0] as number) <= canonicalSamples[rowIndex - 1][0]) {
      return { error: `Time is not strictly increasing at row ${rowIndex}.` };
    }
    canonicalSamples.push(values as [number, number, number, number]);
  }
  const warnings: string[] = [];
  if (source.units === undefined) warnings.push("Units were missing; assumed m/s^2.");
  const spacings = canonicalSamples.slice(1).map((row, index) => row[0] - canonicalSamples[index][0]).sort((a, b) => a - b);
  const medianSpacing = spacings.length ? spacings[Math.floor(spacings.length / 2)] : 0;
  if (medianSpacing && Math.abs(1_000_000 / medianSpacing - Number(source.sample_rate_hz)) / Number(source.sample_rate_hz) > 0.1) {
    warnings.push("Median sample spacing disagrees with sample_rate_hz by more than 10%.");
  }
  const resting = canonicalSamples.slice(0, 20).reduce((sum, row) => sum + Math.hypot(row[1], row[2], row[3]), 0) / Math.min(20, canonicalSamples.length);
  if (Math.abs(resting - 9.80665) / 9.80665 > 0.1) warnings.push("Resting magnitude is not within 10% of 9.81 m/s^2; check units or range.");
  if (canonicalSamples.length < 100) warnings.push(`Only ${canonicalSamples.length} samples; results may be limited.`);
  const ignored = ["altitude", "pitch"].filter((column) => columns.includes(column));
  if (ignored.length) warnings.push(`${ignored.join(" and ")} column${ignored.length > 1 ? "s were" : " was"} ignored; the bot does not use ${ignored.join(" or ")}.`);
  return {
    flight: {
      flight_id: Number(source.flight_id),
      sample_rate_hz: Number(source.sample_rate_hz),
      range_g: Number(source.range_g),
      units: "m/s^2" as const,
      columns: [...requiredColumns] as ["t_us", "ax", "ay", "az"],
      samples: canonicalSamples,
      date: new Date().toISOString().slice(0, 10),
      isDemoData: metadata.isDemoData,
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
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const samples = flight.samples.map(([t_us, ax, ay, az]) => ({ time: t_us / 1_000_000, ax, ay, az, magnitude: Math.hypot(ax, ay, az) }));
  const renderedSamples = samples.length > 5000
    ? samples.filter((_, index) => index % Math.ceil(samples.length / 5000) === 0)
    : samples;
  const maxAcceleration = Math.max(...samples.map((item) => item.magnitude), 1);
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
    .map((item, pointIndex) => `${pointIndex ? "L" : "M"} ${toX(item.time)} ${toY(item[key])}`).join(" ");
  const launchTime = stats?.launchTime?.value ?? 0;
  const burnoutTime = stats?.burnTime?.value && stats.launchTime?.value ? stats.launchTime.value + stats.burnTime.value : null;
  const nextPoint = samples.find((item) => item.time >= currentTime) ?? samples[samples.length - 1];
  const previousPoint = samples[samples.indexOf(nextPoint) - 1] ?? nextPoint;
  const segmentLength = nextPoint.time - previousPoint.time;
  const segmentProgress = segmentLength === 0 ? 0 : (currentTime - previousPoint.time) / segmentLength;
  const point = {
    time: currentTime,
    ax: previousPoint.ax + (nextPoint.ax - previousPoint.ax) * segmentProgress,
    ay: previousPoint.ay + (nextPoint.ay - previousPoint.ay) * segmentProgress,
    az: previousPoint.az + (nextPoint.az - previousPoint.az) * segmentProgress,
    magnitude: previousPoint.magnitude + (nextPoint.magnitude - previousPoint.magnitude) * segmentProgress,
  };
  const pointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return rangeStart + (fraction * (rangeEnd - rangeStart));
  };

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
        <div><p className="eyebrow">FLIGHT TELEMETRY</p><h2>{flight.label ?? `Flight ${flight.flight_id}`}</h2></div>
        {flight.isDemoData && <span className="demo-pill">DEMO DATA</span>}
      </div>
      <div className="flight-actions"><button type="button" onClick={onPaste}>Paste data</button><button type="button" onClick={() => setZoom([0, 1])}>Reset zoom</button><button type="button" onClick={() => { const span = zoom[1] - zoom[0]; setZoom([Math.max(0, zoom[0] - span * .25), Math.max(span, zoom[1] - span * .25)]); }}>Pan left</button><button type="button" onClick={() => { const span = zoom[1] - zoom[0]; setZoom([Math.min(1 - span, zoom[0] + span * .25), Math.min(1, zoom[1] + span * .25)]); }}>Pan right</button></div>
      <div className="axis-toggles">{(["ax", "ay", "az"] as const).map((axis) => <label key={axis}><input type="checkbox" checked={visibleAxes[axis]} onChange={() => setVisibleAxes((current) => ({ ...current, [axis]: !current[axis] }))} /> {axis}</label>)}</div>
      <svg className="flight-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Acceleration magnitude over time for flight ${flight.flight_id}`} onPointerMove={(event) => { if (dragStart === null) setCurrentTime(pointFromEvent(event)); }} onPointerDown={(event) => setDragStart(pointFromEvent(event))} onPointerUp={(event) => { if (dragStart !== null) { const end = pointFromEvent(event); const start = Math.min(dragStart, end); const finish = Math.max(dragStart, end); if (finish - start > maxTime * 0.02) setZoom([start / maxTime, finish / maxTime]); } setDragStart(null); }}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={pad} x2={chartWidth - pad / 2} y1={toY(Math.max(limit, maxAcceleration) * fraction)} y2={toY(Math.max(limit, maxAcceleration) * fraction)} className="chart-grid" />
        ))}
        <line x1={pad} x2={chartWidth - pad / 2} y1={toY(limit)} y2={toY(limit)} className="sensor-limit" />
        <line x1={toX(launchTime)} x2={toX(launchTime)} y1={14} y2={chartHeight - pad} className="flight-marker" />
        {burnoutTime !== null && <line x1={toX(burnoutTime)} x2={toX(burnoutTime)} y1={14} y2={chartHeight - pad} className="flight-marker" />}
        <path d={pathFor("magnitude")} className="acceleration-line" />
        {visibleAxes.ax && <path d={pathFor("ax")} className="axis-line axis-x" />}
        {visibleAxes.ay && <path d={pathFor("ay")} className="axis-line axis-y" />}
        {visibleAxes.az && <path d={pathFor("az")} className="axis-line axis-z" />}
        {renderedSamples.filter((item) => item.time >= rangeStart && item.time <= rangeEnd && item.magnitude >= limit * 0.98).map((item) => (
          <circle key={item.time} cx={toX(item.time)} cy={toY(item.magnitude)} r="2.5" className="clipped-sample" />
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
      {stats && <><div className="stats-table">{(["restingMagnitude", "magnitude", "launchTime", "burnTime", "peakAcceleration", "flightTime", "launchSpeed", "peakThrust", "impulse", "estimatedRange"] as const).map((key) => {
        const stat = stats[key];
        return <div className="stat-row" key={key} title={stat?.note ?? stats.reason}><span>{key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}</span><strong>{stat?.value === null || !stat ? "Not detected" : `${typeof stat.value === "number" ? stat.value.toFixed(2) : stat.value} ${stat.unit}`}</strong><em>{stat?.label ?? "estimated"}</em></div>;
      })}</div><div className="range-arc"><svg viewBox="0 0 220 70" role="img" aria-label="Estimated projectile arc"><path d="M10 58 Q 110 0 210 58" /><line x1="10" y1="58" x2="210" y2="58" /><text x="110" y="68" textAnchor="middle">Estimated, ignores drag</text></svg></div></>}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const initialFlight = demoFlight as unknown as FlightData;
  const [flights, setFlights] = useState<FlightData[]>([initialFlight]);
  const [selectedFlight, setSelectedFlight] = useState<FlightData>(initialFlight);
  const [selectedStats, setSelectedStats] = useState<FlightStats>(() => get_flight_stats(initialFlight.flight_id, initialFlight));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  const [flightLabel, setFlightLabel] = useState(`Flight ${initialFlight.flight_id}`);
  const [launchAngle, setLaunchAngle] = useState(String(Number.parseFloat(rocketFacts.launchAngle_deg.value ?? "50")));
  const [launchPressure, setLaunchPressure] = useState(String(Number.parseFloat(rocketFacts.launchPressure_bar.value ?? "5")));
  const [waterVolume, setWaterVolume] = useState(String(Number.parseFloat(rocketFacts.waterVolume_ml.value ?? "500")));
  const [pasteDemo, setPasteDemo] = useState(false);
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
      if (Array.isArray(saved) && saved.length) window.setTimeout(() => setFlights((current) => [...current, ...saved]), 0);
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
      isDemoData: pasteDemo,
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
      setFlights((current) => current.filter((flight) => flight === initialFlight));
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
        body: JSON.stringify({ messages: history.slice(-30).map(({ role, text }) => ({ role: role === "bot" ? "assistant" : "user", content: text })), flight: selectedFlight }),
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
    ["LENGTH", rocketFacts.length],
    ["DRY MASS", rocketFacts.dryMass_kg],
    ["WATER MASS", rocketFacts.waterMass_kg],
    ["LONG AXIS", rocketFacts.longAxis],
    ["AXIS SIGN", rocketFacts.axisSign],
    ["LAUNCH ANGLE", rocketFacts.launchAngle_deg],
    ["WATER VOLUME", rocketFacts.waterVolume_ml],
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
                  <div className="message-bubble"><p>{message.text}</p>{message.stats && <div className="computed-tag">Computed from {message.stats.flightId}{message.stats.isDemoData && " · Demo data"}</div>}<time>{message.role === "bot" ? "Answer" : "You"}</time></div>
                </div>
              ))}
              {isLoading && <div className="typing-indicator"><span /><span /><span /> Thinking…</div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="quick-ask"><p>TRY ASKING</p><div>{quickQuestions.map((question) => <button key={question} onClick={() => submit(question)}>{question}</button>)}</div></div>
            <form className="composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit(input); }}>
              <input aria-label="Ask about the water rocket" maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question about our water rocket..." />
              <button aria-label="Send question" type="submit" disabled={isLoading}><SendIcon /></button>
            </form>
            {error && <p className="chat-error" role="alert">{error}</p>}
            <p className="disclaimer">Answers come from TeamAOA project data. Unconfirmed values are marked.</p>
          </section>
          <aside className="info-column">
            <div className="info-card snapshot"><div className="card-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Rocket snapshot</h2></div></div><div className="spec-grid">{snapshotFacts.map(([label, fact]) => <div key={label}><span>{label}</span><strong>{fact.value} <DemoTag status={fact.status} /></strong><small>{fact.note}</small></div>)}</div><div className="pressure-row"><span>LAUNCH PRESSURE</span><strong>{rocketFacts.launchPressure_bar.value} <DemoTag status={rocketFacts.launchPressure_bar.status} /><em> gauge</em></strong></div><div className="not-confirmed"><span className="warning-icon">!</span><span>Measured range <strong>not yet available</strong></span></div></div>
            <div ref={flightPanelRef}><div className="flight-list">{flights.map((flight) => <button type="button" className={flight.flight_id === selectedFlight.flight_id ? "selected" : ""} key={flight.flight_id} onClick={() => selectFlight(flight.flight_id)}>{flight.label ?? `Flight ${flight.flight_id}`}{flight.isDemoData && " · DEMO"}</button>)}</div><FlightPanel key={selectedFlight.flight_id} flight={selectedFlight} stats={selectedStats} onPaste={openPaste} />
              {pasteOpen && <div className="paste-panel">
                <h3>Paste flight data</h3>
                <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) readFile(file); }} placeholder='{"flight_id":2,"sample_rate_hz":200,"range_g":16,"units":"m/s^2","columns":["t_us","ax","ay","az"],"samples":[]}' />
                <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); }} />
                <button type="button" onClick={() => fileInputRef.current?.click()}>Choose .json file</button>
                <div className="paste-fields">
                  <label>Flight label<input value={flightLabel} onChange={(event) => setFlightLabel(event.target.value)} /></label>
                  <label>Launch angle (deg)<input value={launchAngle} onChange={(event) => setLaunchAngle(event.target.value)} /> <DemoTag status={rocketFacts.launchAngle_deg.status} /></label>
                  <label>Launch pressure (bar)<input value={launchPressure} onChange={(event) => setLaunchPressure(event.target.value)} /> <DemoTag status={rocketFacts.launchPressure_bar.status} /></label>
                  <label>Water volume (mL)<input value={waterVolume} onChange={(event) => setWaterVolume(event.target.value)} /> <DemoTag status={rocketFacts.waterVolume_ml.status} /></label>
                </div>
                <label className="paste-toggle"><input type="checkbox" checked={pasteDemo} onChange={(event) => setPasteDemo(event.target.checked)} /> This is demo/synthetic data</label>
                <label className="paste-toggle"><input type="checkbox" checked={saveToBrowser} onChange={(event) => setSaveToBrowser(event.target.checked)} /> Save to this browser</label>
                <div className="paste-actions"><button type="button" onClick={loadPastedFlight}>Load</button><button type="button" onClick={() => setPasteOpen(false)}>Cancel</button><button type="button" onClick={deleteSavedFlights}>Clear saved</button></div>
                {pasteError && <p className="chat-error" role="alert">{pasteError}</p>}
                {pasteWarnings.map((warning) => <p className="paste-warning" key={warning}>{warning}</p>)}
              </div>}
              {!pasteOpen && pasteWarnings.map((warning) => <p className="paste-warning" key={warning}>{warning}</p>)}
            </div>
            <div className="safety-strip" id="safety"><strong>Safety</strong><span>Goggles during pressurization</span><span>Stay 4.6 m (15 ft) behind the rope</span><span>Never handle a pressurized rocket</span><span>Inspect the bottle before launch</span><small>Only authorized people operate the pump and launcher.</small></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
