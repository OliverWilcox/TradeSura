import { describe, expect, it } from "vitest";
import { checkEmergency } from "@/lib/compliance/interlock";

describe("gas-emergency interlock", () => {
  const emergencies = [
    "I can smell gas in the kitchen",
    "There's a gas smell near the meter",
    "gas leak under the boiler",
    "I think it's leaking gas",
    "carbon monoxide alarm went off",
    "my CO alarm is beeping",
    "CO detector triggered last night",
    "strange fumes from the flue",
    "feeling dizzy when the boiler runs",
    "SMELL OF GAS", // case-insensitive
  ];
  for (const text of emergencies) {
    it(`triggers: "${text}"`, () => {
      expect(checkEmergency(text).emergency).toBe(true);
    });
  }

  const safe = [
    "radiators cold downstairs since yesterday",
    "can I move my service to the 19th",
    "the boiler is making a rattling noise",
    "my gas bill seems high", // gas alone, no smell/leak
    "pilot light keeps going out",
  ];
  for (const text of safe) {
    it(`does not trigger: "${text}"`, () => {
      expect(checkEmergency(text).emergency).toBe(false);
    });
  }
});
