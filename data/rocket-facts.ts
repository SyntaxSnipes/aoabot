export type FactStatus = "confirmed" | "unconfirmed";

export type RocketFact<T> = {
  value: T;
  status: FactStatus;
  note?: string;
};

export const SAFETY_FACTS = [
  "Everyone in the launch area wears safety goggles during pressurization and launch.",
  "A countdown is used before every launch so everyone knows a launch is about to happen.",
  "After pressurization, all participants and observers move behind the roped-off safety area before the countdown and launch.",
  "Minimum safety distance is 15 feet (about 4.6 m), or more if the instructor or safety coordinator specifies.",
  "Never approach or handle a pressurized rocket.",
  "Only authorized personnel operate the launch and pressurization equipment.",
  "Plastic bottles weaken with repeated use and can rupture or explode under pressure. Two-liter bottles need particular attention.",
  "Inspect bottles before every launch. Do not use a bottle with cracks, deformation, scratches, whitening or other damage.",
  "Retire bottles after about 10 to 15 launches, or earlier if any deterioration is seen.",
  "Onboard battery: secure and pad it, inspect it after every landing, never charge or handle a damaged battery.",
] as const;

export const rocketFacts: Record<string, RocketFact<string | null>> = {
  bottle: {
    value: "1.5 L",
    status: "confirmed",
    note: "Reused PET soft-drink bottle",
  },
  length: {
    value: "44 cm",
    status: "unconfirmed",
    note: "Nozzle to nose tip; competition limit is under 50 cm",
  },
  noseCone: {
    value: "3D printed; material not confirmed",
    status: "unconfirmed",
    note: "Houses the electronics",
  },
  otherParts: {
    value: "3D printed",
    status: "confirmed",
    note: "All parts other than the bottle",
  },
  finConfiguration: {
    value: "Not confirmed",
    status: "unconfirmed",
  },
  dryMass_kg: {
    value: "0.18 kg",
    status: "unconfirmed",
    note: "Bottle, printed parts, electronics, and battery; excludes water",
  },
  waterMass_kg: {
    value: "0.50 kg",
    status: "unconfirmed",
    note: "Estimated from the water load",
  },
  longAxis: {
    value: "y",
    status: "unconfirmed",
    note: "Nose direction is the negative y sensor axis",
  },
  axisSign: {
    value: "-1",
    status: "unconfirmed",
    note: "Sign that points along the rocket nose",
  },
  launchAngle_deg: {
    value: "50°",
    status: "unconfirmed",
  },
  launchPressure_bar: {
    value: "5 bar",
    status: "unconfirmed",
    note: "Gauge pressure",
  },
  waterVolume_ml: {
    value: "500 mL",
    status: "unconfirmed",
  },
  bestMeasuredRange: {
    value: null,
    status: "unconfirmed",
  },
  electronics: {
    value: "ESP32 accelerometer",
    status: "confirmed",
  },
  electronicsMass: {
    value: "about 30 g",
    status: "unconfirmed",
  },
  battery: {
    value: "Not confirmed",
    status: "unconfirmed",
  },
};

export const hasUnconfirmedFacts = Object.values(rocketFacts).some(
  (fact) => fact.status === "unconfirmed",
);

export function factPromptLines() {
  return Object.entries(rocketFacts)
    .map(([name, fact]) => `- ${name}: ${fact.status === "confirmed" ? fact.value ?? "not confirmed" : "not confirmed"}${fact.note && fact.status === "confirmed" ? `; ${fact.note}` : ""}`)
    .join("\n");
}
