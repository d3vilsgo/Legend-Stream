import { Redirect } from "expo-router";
import OptimizedHomeScreenV6 from "@/components/OptimizedHomeScreenV6";
import { isCatalogBenchmarkBuildEnabled } from "@/lib/catalogBenchmarkEntry";

export default function IndexScreen() {
  if (isCatalogBenchmarkBuildEnabled()) return <Redirect href="/catalog-benchmark" />;
  return <OptimizedHomeScreenV6 />;
}
