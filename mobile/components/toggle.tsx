import { Switch, type SwitchProps } from "react-native";

// Build Review 3, §3 — toggles are iOS-style switches in TradeSura blue.
// Blue is the action colour; green is money only, so never a green track.
const TRACK_ON = "#5FA3F0";
const TRACK_OFF = "#2A3D58";

export type ToggleProps = Omit<SwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor" | "onValueChange"> & {
  value: boolean;
  onValueChange?: (value: boolean) => void;
};

export function Toggle(props: ToggleProps) {
  return (
    <Switch
      {...props}
      trackColor={{ false: TRACK_OFF, true: TRACK_ON }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={TRACK_OFF}
    />
  );
}
