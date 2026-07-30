// TradePacks (handover §3 multi-trade + §5). A trade only gets a pack if a
// recurring service event anchors it — no service anchor (plumbing, drains)
// means no plan. Packs stay "coming soon" until each clause library is
// solicitor-approved.
export const TRADE_PACKS = [
  {
    code: "GAS_SAFE",
    name: "Gas Safe",
    anchor: "Annual boiler service · Gas Safe register",
    live: true,
  },
  { code: "HEAT_PUMP", name: "Heat pump", anchor: "Annual service, warranty-mandated · MCS register", live: false },
  { code: "OIL", name: "Oil boiler", anchor: "Annual service · OFTEC", live: false },
  {
    code: "ELECTRICAL",
    name: "Electrical",
    anchor: "EICR on the 5-year cycle + annual smoke/CO check",
    live: false,
    cycleMonths: 60,
  },
  { code: "SOLAR", name: "Solar", anchor: "Annual system health & inverter check, panel clean", live: false },
  { code: "AIRCON", name: "Air conditioning", anchor: "Annual F-Gas service", live: false },
  { code: "CHIMNEY", name: "Chimney sweep", anchor: "Annual sweep · HETAS insurance condition", live: false },
  { code: "EV_CHARGER", name: "EV charger", anchor: "Annual check", live: false },
] as const;

export type TradeCode = (typeof TRADE_PACKS)[number]["code"];
