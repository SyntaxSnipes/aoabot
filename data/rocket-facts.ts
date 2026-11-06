export type FactStatus = "confirmed" | "demo";

export type RocketFact<T> = {
  value: T;
  status: FactStatus;
  note?: string;
};

export const rocketFacts: Record<string, RocketFact<string | null>> = {
  bottle: {
    value: "1.5 L",
    status: "confirmed",
    note: "Reused PET soft-drink bottle",
  },
  length: {
    value: "44 cm",
    status: "demo",
    note: "Nozzle to nose tip; competition limit is under 50 cm",
  },
  noseCone: {
    value: "3D printed; material not confirmed",
    status: "demo",
    note: "Houses the electronics",
  },
  otherParts: {
    value: "3D printed",
    status: "confirmed",
    note: "All parts other than the bottle",
  },
  finConfiguration: {
    value: "Not confirmed",
    status: "demo",
  },
  dryMass_kg: {
    value: "0.18 kg",
    status: "demo",
    note: "Bottle, printed parts, electronics, and battery; excludes water",
  },
  waterMass_kg: {
    value: "0.50 kg",
    status: "demo",
    note: "Estimated from the water load",
  },
  longAxis: {
    value: "y",
    status: "demo",
    note: "Nose direction is the negative y sensor axis",
  },
  axisSign: {
    value: "-1",
    status: "demo",
    note: "Sign that points along the rocket nose",
  },
  launchAngle_deg: {
    value: "50°",
    status: "demo",
  },
  launchPressure_bar: {
    value: "5 bar",
    status: "demo",
    note: "Gauge pressure",
  },
  waterVolume_ml: {
    value: "500 mL",
    status: "demo",
  },
  bestMeasuredRange: {
    value: null,
    status: "demo",
  },
  electronics: {
    value: "ESP32 accelerometer",
    status: "confirmed",
  },
  electronicsMass: {
    value: "about 30 g",
    status: "confirmed",
  },
  battery: {
    value: "Not confirmed",
    status: "demo",
  },
};

export const hasDemoFacts = Object.values(rocketFacts).some(
  (fact) => fact.status === "demo",
);

export function factPromptLines() {
  return Object.entries(rocketFacts)
    .map(([name, fact]) => `- ${name}: ${fact.value ?? "not determined"} (${fact.status})${fact.note ? `; ${fact.note}` : ""}`)
    .join("\n");
}
