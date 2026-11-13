import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FlightData } from "@/lib/flightStats";

const dataDirectory = path.join(process.cwd(), "data", "flights");

export function loadFlight(flightId: number): FlightData | null {
  for (const filename of readdirSync(dataDirectory).filter((entry) => entry.endsWith(".json"))) {
    const flight = JSON.parse(readFileSync(path.join(dataDirectory, filename), "utf8")) as FlightData;
    if (process.env.NODE_ENV === "production" && flight.provenance === "demo") continue;
    if (flight.flight_id === flightId) return flight;
  }
  return null;
}

export function listFlights() {
  return readdirSync(dataDirectory)
    .filter((entry) => entry.endsWith(".json"))
    .map((filename) => JSON.parse(readFileSync(path.join(dataDirectory, filename), "utf8")) as FlightData)
    .filter((flight) => process.env.NODE_ENV !== "production" || flight.provenance !== "demo")
    .map((flight) => ({ flightId: flight.flight_id, date: flight.date, provenance: flight.provenance }));
}
