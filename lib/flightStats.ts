import { rocketFacts } from "@/data/rocket-facts";

export type FlightSample = [number, number, number, number];
export type FlightProvenance = "real" | "demo" | "unverified";
export type LaunchType = "launcher" | "hand_throw" | "drop_test" | "other";
export type FlightData = {
  flight_id: number;
  sample_rate_hz: number;
  range_g: number;
  units: "m/s^2";
  columns: ["t_us", "ax", "ay", "az"];
  samples: FlightSample[];
  date?: string;
  provenance: FlightProvenance;
  label?: string;
  launch: { angle_deg: number; pressure_bar: number; water_ml: number };
  launchType: LaunchType;
};

type Value<T> = {
  value: T;
  label: "measured" | "estimated";
  unit: string;
  note: string;
};

export type FlightStats = {
  flightId: number;
  provenance: FlightProvenance;
  launchType: LaunchType;
  restingMagnitude: Value<number> | null;
  magnitude: Value<{ peak: number; clipped: boolean }> | null;
  freeFallStart: Value<number> | null;
  impactTime: Value<number> | null;
  impactAcceleration: Value<number> | null;
  roughApogee: Value<number> | null;
  releaseAcceleration: Value<number> | null;
  launchTime: Value<number> | null;
  burnTime: Value<number> | null;
  peakAcceleration: Value<number> | null;
  flightTime: Value<number> | null;
  launchSpeed: Value<number> | null;
  peakThrust: Value<number> | null;
  impulse: Value<number> | null;
  estimatedRange: Value<number> | null;
  clipped: boolean;
  reason?: string;
};

export type StatsWindow = { startTime: number; endTime: number };

const g = 9.80665;
function missing<T>(note: string): Value<T> {
  return { value: null as T, label: "estimated", unit: "", note };
}

function value<T>(result: T, label: Value<T>["label"], unit: string, note: string): Value<T> {
  return { value: result, label, unit, note };
}

function confirmedValue(name: keyof typeof rocketFacts) {
  const fact = rocketFacts[name];
  return fact.status === "confirmed" ? fact.value : null;
}

function flightConfig() {
  const axisValue = confirmedValue("longAxis");
  const axis = axisValue === "x" || axisValue === "y" || axisValue === "z" ? axisValue : null;
  const signValue = confirmedValue("axisSign");
  const sign = Number(signValue);
  const axisIndex = axis ? { x: 1, y: 2, z: 3 }[axis] : null;
  const angleValue = confirmedValue("launchAngle_deg");
  const dryMassValue = confirmedValue("dryMass_kg");
  const waterMassValue = confirmedValue("waterMass_kg");
  const waterVolumeValue = confirmedValue("waterVolume_ml");
  return {
    axisIndex,
    sign: sign === 1 || sign === -1 ? sign : -1,
    angle: angleValue === null ? null : Number.parseFloat(angleValue) * Math.PI / 180,
    dryMass: dryMassValue === null ? null : Number.parseFloat(dryMassValue),
    waterMass: waterMassValue !== null
      ? Number.parseFloat(waterMassValue)
      : waterVolumeValue === null ? null : Number.parseFloat(waterVolumeValue) / 1000,
  };
}

export function get_flight_stats(flightId: number, flight?: FlightData, selection?: StatsWindow): FlightStats {
  if (!flight || flight.samples.length === 0) {
    return {
      flightId,
      provenance: flight?.provenance ?? "unverified",
      launchType: flight?.launchType ?? "other",
      restingMagnitude: null,
      magnitude: null,
      freeFallStart: null,
      impactTime: null,
      impactAcceleration: null,
      roughApogee: null,
      releaseAcceleration: null,
      launchTime: null,
      burnTime: null,
      peakAcceleration: null,
      flightTime: null,
      launchSpeed: null,
      peakThrust: null,
      impulse: null,
      estimatedRange: null,
      clipped: false,
      reason: "No samples are available for this flight.",
    };
  }

  const config = flightConfig();
  const selectedSamples = selection
    ? flight.samples.filter((sample) => sample[0] / 1_000_000 >= selection.startTime && sample[0] / 1_000_000 <= selection.endTime)
    : flight.samples;
  const samples = selectedSamples.length > 0 ? selectedSamples : flight.samples;
  const staticSamples = samples.filter((sample) => sample[0] <= 500000);
  const baselineSamples = staticSamples.length > 0 ? staticSamples : flight.samples.slice(0, Math.min(3, flight.samples.length));
  const expected = [0, 0, 0];
  if (config.axisIndex) expected[config.axisIndex - 1] = g * config.sign;
  const bias = [0, 1, 2].map((index) => (
    baselineSamples.reduce((sum, sample) => sum + sample[index + 1], 0) / baselineSamples.length - expected[index]
  ));
  const corrected = samples.map((sample) => {
    const axes = [0, 1, 2].map((index) => sample[index + 1] - bias[index]);
    return {
      time: sample[0] / 1_000_000,
      axes,
      magnitude: Math.hypot(...axes),
      axis: config.axisIndex ? axes[config.axisIndex - 1] * config.sign : null,
    };
  });
  const baselineAxis = config.axisIndex
    ? corrected.slice(0, baselineSamples.length)
      .reduce((sum, sample) => sum + (sample.axis ?? 0), 0) / baselineSamples.length
    : null;
  const baselineMagnitude = corrected.slice(0, baselineSamples.length)
    .reduce((sum, sample) => sum + sample.magnitude, 0) / baselineSamples.length;
  const limit = flight.range_g * g;
  const clipped = corrected.some((sample) => sample.magnitude >= limit * 0.98);
  const peak = Math.max(...corrected.map((sample) => sample.magnitude));
  const freeFallWindows: Array<{ start: number; end: number }> = [];
  let freeFallStartIndex = -1;
  for (let index = 0; index < corrected.length; index += 1) {
    if (corrected[index].magnitude >= 3) continue;
    const start = index;
    while (index + 1 < corrected.length && corrected[index + 1].magnitude < 3) index += 1;
    if (corrected[index].time - corrected[start].time >= 0.3) {
      freeFallWindows.push({ start, end: index });
    }
  }
  const freeFall = freeFallWindows.sort((a, b) => (
    (corrected[b.end].time - corrected[b.start].time) - (corrected[a.end].time - corrected[a.start].time)
  ))[0];
  if (freeFall) freeFallStartIndex = freeFall.start;
  const freeFallStart = freeFall ? corrected[freeFall.start] : null;
  const impactIndex = freeFall
    ? corrected.findIndex((sample, index) => index > freeFall.end && sample.magnitude > 8 * g)
    : -1;
  const impact = impactIndex >= 0 ? corrected[impactIndex] : null;
  const flightSeconds = freeFallStart && impact ? impact.time - freeFallStart.time : null;
  const impactSeconds = impact?.time ?? null;
  const accelerationNote = clipped ? "Measured; sensor clipping makes this a lower bound." : "Measured from the acceleration magnitude.";

  let launchSpeed: number | null = null;
  let peakThrust: number | null = null;
  let impulse: number | null = null;
  let burnSeconds: number | null = null;
  const launch = freeFallStart;
  const burnoutIndex = freeFallStartIndex >= 0
    ? corrected.findIndex((sample, index) => index > freeFallStartIndex && (
      config.axisIndex
        ? (sample.axis ?? 0) <= (baselineAxis ?? 0) + 1
        : sample.magnitude <= baselineMagnitude + 1
    ))
    : -1;
  const burnout = burnoutIndex >= 0 ? corrected[burnoutIndex] : null;
  burnSeconds = launch && burnout ? burnout.time - launch.time : null;
  const massReason = config.dryMass === null
    ? "needs confirmed dry mass"
    : config.waterMass === null
      ? "needs confirmed water mass or water volume"
      : null;
  const analysisReason = config.axisIndex === null
    ? "needs confirmed long axis"
    : config.angle === null
      ? "needs confirmed launch angle"
      : massReason;
  if (flight.launchType === "launcher" && launch && burnSeconds && burnSeconds > 0 && config.axisIndex
    && config.angle !== null && config.dryMass !== null && config.waterMass !== null) {
    const burnSamples = corrected.slice(launchIndex, burnoutIndex >= 0 ? burnoutIndex + 1 : corrected.length);
    let speed = 0;
    let thrustImpulse = 0;
    let thrustPeak = 0;
    for (let index = 1; index < burnSamples.length; index += 1) {
      const previous = burnSamples[index - 1];
      const current = burnSamples[index];
      const dt = current.time - previous.time;
      const previousForce = (previous.axis ?? 0) - g * Math.sin(config.angle);
      const currentForce = (current.axis ?? 0) - g * Math.sin(config.angle);
      speed += ((previousForce + currentForce) / 2) * dt;
      const previousMass = config.dryMass + config.waterMass * Math.max(0, 1 - (previous.time - launch.time) / burnSeconds);
      const currentMass = config.dryMass + config.waterMass * Math.max(0, 1 - (current.time - launch.time) / burnSeconds);
      const previousThrust = previousMass * (previous.axis ?? 0);
      const currentThrust = currentMass * (current.axis ?? 0);
      thrustPeak = Math.max(thrustPeak, previousThrust, currentThrust);
      thrustImpulse += ((previousThrust + currentThrust) / 2) * dt;
    }
    launchSpeed = Math.max(0, speed);
    peakThrust = thrustPeak;
    impulse = thrustImpulse;
  }
  const range = launchSpeed !== null && config.angle !== null
    ? launchSpeed ** 2 * Math.sin(2 * config.angle) / g
    : null;

  const nonLauncherReason = flight.launchType === "hand_throw"
    ? "Not applicable: hand throw has no thrust phase"
    : flight.launchType === "drop_test"
      ? "Not applicable: drop test has no thrust phase"
      : flight.launchType === "other"
        ? "Not applicable: launch type is other / unknown"
        : null;
  const releaseAcceleration = flight.launchType === "hand_throw" && freeFallStart
    ? Math.max(...corrected
      .filter((sample) => sample.time >= freeFallStart.time - 0.5 && sample.time < freeFallStart.time)
      .map((sample) => sample.magnitude), 0)
    : null;

  return {
    flightId,
    provenance: flight.provenance,
    launchType: flight.launchType,
    restingMagnitude: value(baselineMagnitude, "measured", "m/s^2", "Mean magnitude in the first 0.5 s; sanity check against 9.81 m/s^2."),
    magnitude: value({ peak, clipped }, "measured", "m/s^2", "Magnitude is sqrt(ax^2 + ay^2 + az^2) for every sample."),
    freeFallStart: freeFallStart ? value(freeFallStart.time, "measured", "s", "Start of the longest acceleration-magnitude window below 3 m/s^2 lasting at least 0.3 s.") : missing("No free-fall window of at least 0.3 s was detected."),
    impactTime: impactSeconds !== null ? value(impactSeconds, "measured", "s", "First acceleration-magnitude spike above 8 g after free fall.") : missing("No impact spike above 8 g was detected after free fall."),
    impactAcceleration: impact ? value(impact.magnitude, "measured", clipped ? "m/s^2 (lower bound)" : "m/s^2", "Acceleration magnitude at impact; clipping makes this a lower bound.") : missing("No impact acceleration was detected."),
    roughApogee: flightSeconds !== null
      ? value(g * flightSeconds ** 2 / 8, "estimated", "m", "Estimated, assumes release and landing at the same height, no drag.")
      : missing("Free-fall start and impact are required."),
    releaseAcceleration: releaseAcceleration !== null ? value(releaseAcceleration, "measured", "m/s^2", "Peak acceleration magnitude in the 0.5 s before free-fall start.") : null,
    launchTime: launch ? value(launch.time, "measured", "s", "Free-fall start treated as release or launch.") : null,
    burnTime: flight.launchType !== "launcher" ? missing(nonLauncherReason ?? "Not applicable.") : burnSeconds !== null
      ? value(burnSeconds, "estimated", "s", config.axisIndex
        ? "Launch to return near baseline on the confirmed long axis; the detector is approximate."
        : "Estimated from acceleration magnitude returning near baseline; the long axis is not confirmed.")
      : missing(config.axisIndex
        ? "Burnout was ambiguous or the long-axis signal did not return near baseline."
        : "Burnout was ambiguous in the acceleration magnitude."),
    peakAcceleration: value(peak, "measured", clipped ? "m/s^2 (lower bound)" : "m/s^2", accelerationNote),
    flightTime: flightSeconds !== null
      ? value(flightSeconds, "estimated", "s", "Launch to the final recorded sample, treated as the impact endpoint.")
      : missing("Free-fall start and impact are required."),
    launchSpeed: flight.launchType !== "launcher" ? missing(nonLauncherReason ?? "Not applicable.")
      : launchSpeed !== null
      ? value(launchSpeed, "estimated", "m/s", "Trapezoidal integration of bias-corrected long-axis force minus g*sin(launch angle).")
      : missing(analysisReason ?? "Launch and burnout are required."),
    peakThrust: flight.launchType !== "launcher" ? missing(nonLauncherReason ?? "Not applicable.")
      : peakThrust !== null
      ? value(peakThrust, "estimated", "N", "Approximate T(t) = m(t)*f_axis using a linear water-mass model.")
      : missing(analysisReason ?? "Launch and burnout are required."),
    impulse: flight.launchType !== "launcher" ? missing(nonLauncherReason ?? "Not applicable.")
      : impulse !== null
      ? value(impulse, "estimated", "N s", "Integral of the approximate thrust; water mass decreases linearly.")
      : missing(analysisReason ?? "Launch and burnout are required."),
    estimatedRange: flight.launchType !== "launcher" ? missing(nonLauncherReason ?? "Not applicable.")
      : range !== null
      ? value(range, "estimated", "m", "Projectile range with the configured launch angle; ignores drag and is an upper bound.")
      : missing(config.angle === null ? "needs confirmed launch angle" : "Launch speed is required."),
    clipped,
  };
}
