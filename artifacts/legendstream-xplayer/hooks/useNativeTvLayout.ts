import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nativeTvLayout } from "@/lib/nativeTvResponsive";
export function useNativeTvLayout() {
  const window = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  return nativeTvLayout({ ...window, safeArea });
}
