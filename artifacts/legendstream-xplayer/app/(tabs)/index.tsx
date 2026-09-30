import { Redirect } from "expo-router";
import ProductShell from "@/components/ProductShell";
import { isCatalogBenchmarkBuildEnabled } from "@/lib/catalogBenchmarkEntry";

export default function IndexScreen() {
  if (isCatalogBenchmarkBuildEnabled()) return <Redirect href="/catalog-benchmark" />;
  return <ProductShell />;
}
