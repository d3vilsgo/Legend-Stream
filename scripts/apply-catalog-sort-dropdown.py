from pathlib import Path

path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = path.read_text()

def r(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)

r('type CatalogSortMode = "default" | "alpha" | "added";',
  'type CatalogSortMode = "default" | "alphaAsc" | "alphaDesc" | "idAsc" | "idDesc" | "added";',
  'mode')

r('''const sortCatalogRows = <T extends { name: string }>(
  rows: T[],
  mode: CatalogSortMode,
  addedOf: (item: T) => string | undefined,
) => {
  if (mode === "default") return rows;
  const sorted = [...rows];
  if (mode === "alpha") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
  } else {
    sorted.sort((a, b) => addedTime(addedOf(b)) - addedTime(addedOf(a)));
  }
  return sorted;
};''', '''const catalogNumericId = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const embeddedIndex = text.match(/:(\\d+):/);
  if (embeddedIndex) return Number(embeddedIndex[1]);
  return Number.MAX_SAFE_INTEGER;
};

const sortCatalogRows = <T extends { name: string }>(
  rows: T[],
  mode: CatalogSortMode,
  addedOf: (item: T) => string | undefined,
  idOf: (item: T) => unknown,
) => {
  if (mode === "default") return rows;
  const sorted = [...rows];
  if (mode === "alphaAsc" || mode === "alphaDesc") {
    const direction = mode === "alphaAsc" ? 1 : -1;
    sorted.sort((a, b) => direction * a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
  } else if (mode === "idAsc" || mode === "idDesc") {
    const direction = mode === "idAsc" ? 1 : -1;
    sorted.sort((a, b) => {
      const delta = catalogNumericId(idOf(a)) - catalogNumericId(idOf(b));
      return delta !== 0 ? direction * delta : a.name.localeCompare(b.name, "tr", { sensitivity: "base" });
    });
  } else {
    sorted.sort((a, b) => addedTime(addedOf(b)) - addedTime(addedOf(a)));
  }
  return sorted;
};''', 'sort helper')

r('''        if (
          !cancelled &&
          (saved === "default" || saved === "alpha" || saved === "added")
        ) {
          setCatalogSort(saved);
        }''', '''        if (cancelled) return;
        if (saved === "alpha") {
          setCatalogSort("alphaAsc");
          return;
        }
        if (
          saved === "default" || saved === "alphaAsc" || saved === "alphaDesc" ||
          saved === "idAsc" || saved === "idDesc" || saved === "added"
        ) {
          setCatalogSort(saved);
        }''', 'storage')

r('    return sortCatalogRows(rows, effectiveSort, (item) => item.added);',
  '    return sortCatalogRows(rows, effectiveSort, (item) => item.added, (item) => item.stream_id);',
  'movie sort')

r('''    return sortCatalogRows(
      rows,
      effectiveSort,
      (item) => (item as XtreamSeriesItem & { added?: string }).added,
    );''', '''    return sortCatalogRows(
      rows,
      effectiveSort,
      (item) => (item as XtreamSeriesItem & { added?: string }).added,
      (item) => item.series_id,
    );''', 'series sort')

start = text.index('function SortControl(')
end = text.index('\nfunction Grid<', start)
replacement = '''function SortControl({ selected, supportsAdded, onSelect }: {
  selected: CatalogSortMode;
  supportsAdded: boolean;
  onSelect: (mode: CatalogSortMode) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const options: Array<{ id: CatalogSortMode; label: string; short: string }> = [
    { id: "default", label: t("providerOrder"), short: language === "tr" ? "Varsayılan" : "Default" },
    { id: "alphaAsc", label: language === "tr" ? "Alfabetik — Artan (A-Z)" : "Alphabetical — Ascending (A-Z)", short: "A-Z ↑" },
    { id: "alphaDesc", label: language === "tr" ? "Alfabetik — Azalan (Z-A)" : "Alphabetical — Descending (Z-A)", short: "Z-A ↓" },
    { id: "idAsc", label: language === "tr" ? "ID — Artan" : "ID — Ascending", short: "ID ↑" },
    { id: "idDesc", label: language === "tr" ? "ID — Azalan" : "ID — Descending", short: "ID ↓" },
    ...(supportsAdded ? [{ id: "added" as const, label: language === "tr" ? "Son eklenen (yeni → eski)" : "Newest added", short: language === "tr" ? "Son eklenen" : "Newest" }] : []),
  ];
  const active = options.find((option) => option.id === selected) ?? options[0];
  return <View style={s.sortDropdownWrap}>
    <Pressable onPress={() => setOpen((value) => !value)} style={[s.sortDropdownButton, { borderColor: open ? colors.primary : colors.border, backgroundColor: colors.card }]}>
      <Feather name="sliders" size={16} color={open ? colors.primary : colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{language === "tr" ? "Sırala" : "Sort"}: {active.short}</Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
    </Pressable>
    {open ? <View style={[s.sortDropdownMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((option) => {
        const activeOption = option.id === selected;
        return <Pressable key={option.id} onPress={() => { onSelect(option.id); setOpen(false); }} style={[s.sortDropdownItem, { borderColor: activeOption ? colors.primary : "transparent" }]}>
          <View style={[s.drawerDot, { backgroundColor: activeOption ? colors.primary : "transparent", borderColor: activeOption ? colors.primary : colors.mutedForeground }]} />
          <Text style={{ flex: 1, color: activeOption ? colors.primary : colors.foreground, fontWeight: activeOption ? "800" : "600" }}>{option.label}</Text>
          {activeOption ? <Feather name="check" size={17} color={colors.primary} /> : null}
        </Pressable>;
      })}
    </View> : null}
  </View>;
}
'''
text = text[:start] + replacement + text[end:]

r('  sortRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, paddingTop: 10, paddingBottom: 10 },\n  sortButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },',
  '  sortDropdownWrap: { paddingTop: 10, paddingBottom: 10, alignSelf: "stretch" },\n  sortDropdownButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },\n  sortDropdownMenu: { marginTop: 6, borderWidth: 1, borderRadius: 12, padding: 6, gap: 3 },\n  sortDropdownItem: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },',
  'styles')

path.write_text(text)
