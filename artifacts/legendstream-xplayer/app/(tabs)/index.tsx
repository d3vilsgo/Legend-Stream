import { Redirect } from "expo-router";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import StalkerMainPage from "@/components/StalkerMainPage";
import { usePlayer } from "@/context/PlayerContext";
import { isCatalogBenchmarkBuildEnabled } from "@/lib/catalogBenchmarkEntry";

function ProviderMainPageRouter() {
  const { provider } = usePlayer();
  return provider?.type === "stalker" ? <StalkerMainPage /> : <OptimizedHomeScreenV6 />;
}

export default function IndexScreen() {
  if (isCatalogBenchmarkBuildEnabled()) return <Redirect href="/catalog-benchmark" />;
  return <ProviderMainPageRouter />;
}
