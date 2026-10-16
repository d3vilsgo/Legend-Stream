/** Fictional, self-contained design fixture vocabulary. */
export const eliteSections = [
  { id: "home", label: "Ana Sayfa", icon: "home" },
  { id: "live", label: "Canlı TV", icon: "tv" },
  { id: "movies", label: "Filmler", icon: "film" },
  { id: "series", label: "Diziler", icon: "grid" },
  { id: "settings", label: "Ayarlar", icon: "settings" },
] as const;
export type EliteSection = (typeof eliteSections)[number]["id"];
export const eliteChannels = [
  {
    id: "demo:channel:1",
    number: "01",
    name: "Legend Sinema",
    now: "Kuzeyin Ötesinde",
    next: "Bir Yol Hikâyesi",
    progress: 0.62,
    epg: true,
  },
  {
    id: "demo:channel:2",
    number: "02",
    name: "Legend Doğa",
    now: "Mavi Gezegenin İzinde",
    next: "Yabanın Sesi",
    progress: 0.28,
    epg: true,
  },
  {
    id: "demo:channel:3",
    number: "03",
    name: "Legend Kültür",
    now: "Program bilgisi bulunmuyor",
    next: "",
    progress: 0,
    epg: false,
  },
] as const;
export const elitePosters = [
  {
    id: "demo:poster:1",
    title: "Kuzeyin Ötesinde",
    tag: "FİLM",
    tone: "#24636A",
  },
  { id: "demo:poster:2", title: "Son Işık", tag: "DİZİ", tone: "#7B5845" },
  { id: "demo:poster:3", title: "Derin Mavi", tag: "FİLM", tone: "#285A84" },
  { id: "demo:poster:4", title: "Sessiz Şehir", tag: "DİZİ", tone: "#5B526F" },
  {
    id: "demo:poster:5",
    title: "Uzun Bir Türkçe İçerik Başlığıyla Sınırların Ötesinde",
    tag: "FİLM",
    tone: "#54683E",
  },
] as const;
export type EliteDemoState = {
  active: EliteSection;
  selectedChannel: string;
  overlay: boolean;
  opener: string | null;
  railExpanded: boolean;
  lastAction: string;
};
export const eliteInitialState: EliteDemoState = {
  active: "home",
  selectedChannel: eliteChannels[0].id,
  overlay: false,
  opener: null,
  railExpanded: false,
  lastAction: "Henüz seçim yapılmadı",
};
export type EliteDemoEvent =
  | { type: "navigate"; section: EliteSection }
  | { type: "selectChannel"; id: string }
  | { type: "open"; opener: string }
  | { type: "close" }
  | { type: "rail"; expanded: boolean };
export function eliteDemoReduce(
  state: EliteDemoState,
  event: EliteDemoEvent,
): EliteDemoState {
  if (event.type === "navigate")
    return state.overlay
      ? state
      : {
          ...state,
          active: event.section,
          lastAction: `Bölüm: ${event.section}`,
        };
  if (event.type === "selectChannel")
    return eliteChannels.some((c) => c.id === event.id)
      ? {
          ...state,
          selectedChannel: event.id,
          lastAction: "Örnek kanal seçildi; yayın başlatılmadı",
        }
      : state;
  if (event.type === "open")
    return {
      ...state,
      overlay: true,
      opener: event.opener,
      lastAction: "Örnek kanal paneli açıldı",
    };
  if (event.type === "close")
    return { ...state, overlay: false, lastAction: "Panel kapandı" };
  return state.overlay ? state : { ...state, railExpanded: event.expanded };
}
export function eliteRestoreId(
  opener: string | null,
  mounted: readonly string[],
): string | null {
  return opener && mounted.includes(opener) ? opener : null;
}
