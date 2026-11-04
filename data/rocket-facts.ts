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
  waterLoad: {
    value: "500 mL",
    status: "demo",
    note: "About one third of the bottle",
  },
  launchAngle: {
    value: "50°",
    status: "demo",
  },
  launchPressure: {
    value: "5 bar",
    status: "demo",
    note: "Gauge pressure",
  },
  bestMeasuredRange: {
    value: null,
    status: "demo",
  },
  electronics: {
    value: "ESP32 · barometer · IMU",
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
