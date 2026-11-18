import { useLocalization } from "../../localization";
import { meetingTranslator } from "./messages";
export function useMeetingsLocalization() {
  const value = useLocalization();
  return { ...value, t: meetingTranslator(value.locale) };
}
