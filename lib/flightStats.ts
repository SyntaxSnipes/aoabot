import { rocketFacts } from "@/data/rocket-facts";

export type FlightSample = [number, number, number, number];
export type FlightData = {
  flight_id: number;
  sample_rate_hz: number;
  range_g: number;
  units: "m/s^2";
  columns: ["t_us", "ax", "ay", "az"];
  samples: FlightSample[];
  date?: string;
  isDemoData: boolean;
  label?: string;
  launch: { angle_deg: number; pressure_bar: number; water_ml: number };
};

type Value<T> = {
  value: T;
  label: "measured" | "estimated";
  unit: string;
  note: string;
};

export type FlightStats = {
  flightId: number;
  isDemoData: boolean;
  restingMagnitude: Value<number> | null;
  magnitude: Value<{ peak: number; clipped: boolean }> | null;
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

const g = 9.80665;
function missing<T>(note: string): Value<T> {
  return { value: null as T, label: "estimated", unit: "", note };
}

function value<T>(result: T, label: Value<T>["label"], unit: string, note: string): Value<T> {
  return { value: result, label, unit, note };
}

function flightConfig() {
  const axis = rocketFacts.longAxis.value as "x" | "y" | "z";
  const sign = Number(rocketFacts.axisSign.value);
  const axisIndex = { x: 1, y: 2, z: 3 }[axis];
  return {
    axisIndex,
    sign: sign === 1 || sign === -1 ? sign : -1,
    angle: Number.parseFloat(rocketFacts.launchAngle_deg.value ?? "0") * Math.PI / 180,
    dryMass: Number.parseFloat(rocketFacts.dryMass_kg.value ?? ""),
    waterMass: Number.parseFloat(rocketFacts.waterMass_kg.value ?? ""),
  };
}

export function get_flight_stats(flightId: number, flight?: FlightData): FlightStats {
  if (!flight || flight.samples.length === 0) {
    return {
      flightId,
      isDemoData: Boolean(flight?.isDemoData),
      restingMagnitude: null,
      magnitude: null,
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
  const staticSamples = flight.samples.filter((sample) => sample[0] <= 500000);
  const baselineSamples = staticSamples.length > 0 ? staticSamples : flight.samples.slice(0, Math.min(3, flight.samples.length));
  const expected = [0, 0, 0];
  expected[config.axisIndex - 1] = g * config.sign;
  const bias = [0, 1, 2].map((index) => (
    baselineSamples.reduce((sum, sample) => sum + sample[index + 1], 0) / baselineSamples.length - expected[index]
  ));
  const corrected = flight.samples.map((sample) => {
    const axes = [0, 1, 2].map((index) => sample[index + 1] - bias[index]);
    return {
      time: sample[0] / 1_000_000,
      axes,
      magnitude: Math.hypot(...axes),
      axis: axes[config.axisIndex - 1] * config.sign,
    };
  });
  const baselineAxis = corrected.slice(0, baselineSamples.length)
    .reduce((sum, sample) => sum + sample.axis, 0) / baselineSamples.length;
  const baselineMagnitude = corrected.slice(0, baselineSamples.length)
    .reduce((sum, sample) => sum + sample.magnitude, 0) / baselineSamples.length;
  const limit = flight.range_g * g;
  const clipped = corrected.some((sample) => sample.magnitude >= limit * 0.98);
  const peak = Math.max(...corrected.map((sample) => sample.magnitude));
  const launchIndex = corrected.findIndex((sample) => sample.axis > baselineAxis + 3);
  const launch = launchIndex >= 0 ? corrected[launchIndex] : null;
  const burnoutIndex = launchIndex >= 0
    ? corrected.findIndex((sample, index) => index > launchIndex && sample.axis <= baselineAxis + 1)
    : -1;
  const burnout = burnoutIndex >= 0 ? corrected[burnoutIndex] : null;
  const burnSeconds = launch && burnout ? burnout.time - launch.time : null;
  const impactIndex = corrected.reduce((lastIndex, sample, index) => (
    index > burnoutIndex && sample.magnitude > baselineMagnitude + 3 ? index : lastIndex
  ), -1);
  const flightEnd = impactIndex >= 0 ? corrected[impactIndex] : corrected.length > 1 ? corrected[corrected.length - 1] : null;
  const flightSeconds = launch && flightEnd ? flightEnd.time - launch.time : null;
  const accelerationNote = clipped ? "Measured; sensor clipping makes this a lower bound." : "Measured from the acceleration magnitude.";

  let launchSpeed: number | null = null;
  let peakThrust: number | null = null;
  let impulse: number | null = null;
  if (launch && burnSeconds && burnSeconds > 0 && Number.isFinite(config.dryMass) && Number.isFinite(config.waterMass)) {
    const burnSamples = corrected.slice(launchIndex, burnoutIndex >= 0 ? burnoutIndex + 1 : corrected.length);
    let speed = 0;
    let thrustImpulse = 0;
    let thrustPeak = 0;
    for (let index = 1; index < burnSamples.length; index += 1) {
      const previous = burnSamples[index - 1];
      const current = burnSamples[index];
      const dt = current.time - previous.time;
      const previousForce = previous.axis - g * Math.sin(Number.isFinite(config.angle) ? config.angle : 0);
      const currentForce = current.axis - g * Math.sin(Number.isFinite(config.angle) ? config.angle : 0);
      speed += ((previousForce + currentForce) / 2) * dt;
      const previousMass = config.dryMass + config.waterMass * Math.max(0, 1 - (previous.time - launch.time) / burnSeconds);
      const currentMass = config.dryMass + config.waterMass * Math.max(0, 1 - (current.time - launch.time) / burnSeconds);
      const previousThrust = previousMass * previous.axis;
      const currentThrust = currentMass * current.axis;
      thrustPeak = Math.max(thrustPeak, previousThrust, currentThrust);
      thrustImpulse += ((previousThrust + currentThrust) / 2) * dt;
    }
    launchSpeed = Math.max(0, speed);
    peakThrust = thrustPeak;
    impulse = thrustImpulse;
  }
  const range = launchSpeed !== null && Number.isFinite(config.angle)
    ? launchSpeed ** 2 * Math.sin(2 * config.angle) / g
    : null;

  return {
    flightId,
    isDemoData: flight.isDemoData,
    restingMagnitude: value(baselineMagnitude, "measured", "m/s^2", "Mean magnitude in the first 0.5 s; sanity check against 9.81 m/s^2."),
    magnitude: value({ peak, clipped }, "measured", "m/s^2", "Magnitude is sqrt(ax^2 + ay^2 + az^2) for every sample."),
    launchTime: launch ? value(launch.time, "measured", "s", "First long-axis specific-force sample more than 3 m/s^2 above the static baseline.") : null,
    burnTime: burnSeconds !== null
      ? value(burnSeconds, "estimated", "s", "Launch to return near baseline; the return-to-baseline detector is approximate.")
      : missing("Burnout was ambiguous or the long-axis signal did not return near baseline."),
    peakAcceleration: value(peak, "measured", clipped ? "m/s^2 (lower bound)" : "m/s^2", accelerationNote),
    flightTime: flightSeconds !== null
      ? value(flightSeconds, "estimated", "s", "Launch to the final recorded sample, treated as the impact endpoint.")
      : missing("A launch and final sample are required."),
    launchSpeed: launchSpeed !== null
      ? value(launchSpeed, "estimated", "m/s", "Trapezoidal integration of bias-corrected long-axis force minus g*sin(launch angle).")
      : missing("Launch, burnout, or confirmed mass values are missing."),
    peakThrust: peakThrust !== null
      ? value(peakThrust, "estimated", "N", "Approximate T(t) = m(t)*f_axis using a linear water-mass model.")
      : missing("Launch, burnout, or confirmed mass values are missing."),
    impulse: impulse !== null
      ? value(impulse, "estimated", "N s", "Integral of the approximate thrust; water mass decreases linearly.")
      : missing("Launch, burnout, or confirmed mass values are missing."),
    estimatedRange: range !== null
      ? value(range, "estimated", "m", "Projectile range with the configured launch angle; ignores drag and is an upper bound.")
      : missing("Launch speed and launch angle are required."),
    clipped,
  };
}
