import { nativeTvLayout } from "@/lib/nativeTvResponsive";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { CompactLandscapeNavButton } from "@/components/navigation/CompactLandscapeNavButton";
import { useColors } from "@/hooks/useColors";
import { resolveAdaptiveNavigationModel } from "@/lib/adaptiveNavigation";
import { resolvePremiumCatalogProfile } from "@/lib/design/screenProfiles";
import { useUiPresentation } from "@/context/UiPresentationContext";

export type ResponsiveContentNavItem<Key extends string> = {
  key: Key;
  label: string;
  shortLabel?: string;
  icon: keyof typeof Feather.glyphMap;
};

type Props<Key extends string> = {
  items: readonly ResponsiveContentNavItem<Key>[];
  activeKey: Key;
  onSelect: (key: Key) => void;
  productLabel?: string;
  backEnabled?: boolean;
  placement?: "header" | "bottom";
};

export function ResponsiveContentNav<Key extends string>({
  items,
  activeKey,
  onSelect,
  productLabel = "BÖLÜMLER",
  backEnabled = true,
  placement = "header",
}: Props<Key>) {
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [keyboardOpen,setKeyboardOpen]=useState(false);
  useEffect(()=>{const a=Keyboard.addListener("keyboardDidShow",()=>setKeyboardOpen(true));const b=Keyboard.addListener("keyboardDidHide",()=>setKeyboardOpen(false));return()=>{a.remove();b.remove();};},[]);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const tv = nativeTvLayout({ width, height, fontScale, safeArea: insets }, items.length);
  const presentation = useUiPresentation();
  const [open, setOpen] = useState(Platform.isTV || presentation.tvPreview);
  const [preferInitialFocus, setPreferInitialFocus] = useState(Platform.isTV);
  const navigationFocusedIds = useRef(new Set<string>());
  const profile = useMemo(() => resolvePremiumCatalogProfile({
    width,
    height,
    nativeTv: Platform.isTV,
    tvPreview: presentation.tvPreview,
    safeArea: { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left },
    navState: open ? "open" : "closed",
  }), [height, insets.bottom, insets.left, insets.right, insets.top, open, presentation.tvPreview, width]);
  const model = resolveAdaptiveNavigationModel({
    profile,
    open,
    activeKey,
    itemKeys: items.map((item) => item.key),
  });
  const active = items.find((item) => item.key === activeKey) ?? items[0];
  const homeKey = items[0]?.key;

  useEffect(() => {
    setPreferInitialFocus(false);
  }, []);

  useEffect(() => {
    if (presentation.tvPreview) setOpen(true);
  }, [presentation.tvPreview]);

  useEffect(() => {
    if (!model.nativeTv || !backEnabled || !model.backTarget) return;
    const backTarget = model.backTarget;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      if (navigationFocusedIds.current.size === 0) return false;
      onSelect(backTarget);
      return true;
    });
    return () => back.remove();
  }, [activeKey, backEnabled, homeKey, model.backTarget, model.nativeTv, onSelect]);

  const select = (key: Key) => {
    onSelect(key);
    if (!model.nativeTv) setOpen(false);
  };

  if (placement === "bottom" && (model.nativeTv || presentation.tvPreview)) return null;
  if (model.nativeTv) {
    return (
      <ScrollView
        horizontal
        style={{ flexGrow: 0, flexShrink: 0 }}
        showsHorizontalScrollIndicator
        contentContainerStyle={[styles.tvNav, { paddingLeft: tv.left, paddingRight: tv.right, paddingTop: tv.top, paddingBottom: tv.gutter }]}
        accessibilityLabel="Ana gezinme"
      >
        {items.map((item) => (
          <FocusButton
            key={item.key}
            focusId={`nav:${item.key}`}
            testID={`adaptive-nav-${item.key}`}
            label={item.label}
            icon={item.icon}
            variant={activeKey === item.key ? "secondary" : "ghost"}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeKey === item.key }}
            hasTVPreferredFocus={preferInitialFocus && activeKey === item.key && activeKey === homeKey}
            onFocusChange={(focused) => { if (focused) navigationFocusedIds.current.add(item.key); else navigationFocusedIds.current.delete(item.key); }}
            onPress={() => select(item.key)}
            labelLines={1}
            labelStyle={{ fontSize: tv.labelFont, flexShrink: 1 }}
            style={[styles.tvTarget, { width: tv.navWidth, minHeight: tv.target, paddingHorizontal: 10 }]}
          />
        ))}
      </ScrollView>
    );
  }

  if (presentation.tvPreview) {
    return <ScrollView horizontal style={{flexGrow:0,flexShrink:0}} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tvNav, { paddingHorizontal: Math.max(profile.horizontalPadding, insets.left, insets.right) }]} accessibilityLabel="TV önizleme gezinmesi">
      {items.map((item) => <CompactLandscapeNavButton
        key={item.key}
        label={item.label}
        shortLabel={item.shortLabel}
        icon={item.icon}
        active={activeKey === item.key}
        showLabel
        minTarget={56}
        onPress={() => select(item.key)}
      />)}
    </ScrollView>;
  }

  const itemFor=(key:string)=>items.find(item=>item.key===key);
  const go=(key:string)=>{const item=itemFor(key);if(item)onSelect(item.key);setLibraryOpen(false);};
  if (placement === "header") return <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingBottom:8}}>
    <Text numberOfLines={1} style={{color:colors.foreground,fontSize:18,fontWeight:"800"}}>{["history","downloads"].includes(activeKey)?"Kitaplık":active?.label}</Text>
    <View style={{flexDirection:"row",gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Canlı yayınlarda ara" onPress={()=>go("live")} style={{padding:12}}><Feather name="search" size={21} color={colors.foreground}/><Text style={{color:colors.mutedForeground,fontSize:11}}>Canlı ara</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Kaynak ve ayarlar" onPress={()=>go("settings")} style={{padding:12}}><Feather name="settings" size={21} color={colors.foreground}/></Pressable>
    </View>
  </View>;
  if(keyboardOpen) return null;
  const tabs=[{key:"home",label:"Ana Sayfa",icon:"home"},{key:"live",label:"Canlı",icon:"radio"},{key:"movies",label:"Filmler",icon:"film"},{key:"series",label:"Diziler",icon:"tv"},{key:"library",label:"Kitaplık",icon:"bookmark"}] as const;
  return <View style={{backgroundColor:"#141d25",borderTopWidth:1,borderColor:"#33414a",paddingBottom:Math.max(insets.bottom,8),paddingTop:8}}>
    <View style={{flexDirection:"row",justifyContent:"space-around"}} accessibilityLabel="Ana gezinme">
      {tabs.map(tab=>{const selected=tab.key===activeKey || tab.key==="library"&&["history","downloads"].includes(activeKey);return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{selected}} accessibilityLabel={tab.label} onPress={()=>tab.key==="library"?setLibraryOpen(true):go(tab.key)} style={{flex:1,minHeight:48,alignItems:"center",justifyContent:"center",gap:4,borderTopWidth:2,borderColor:selected?"#67e8d1":"transparent"}}><Feather name={tab.icon} size={20} color={selected?"#67e8d1":"#9eacb7"}/><Text numberOfLines={1} style={{fontSize:width>height?10:11,fontWeight:"700",color:selected?"#67e8d1":"#9eacb7"}}>{tab.label}</Text></Pressable>;})}
    </View>
    <Modal visible={libraryOpen} transparent animationType="slide" onRequestClose={()=>setLibraryOpen(false)}>
      <View style={{flex:1,justifyContent:"flex-end",backgroundColor:"#0009"}}>
        <Pressable accessibilityLabel="Kitaplığı kapat" style={{flex:1}} onPress={()=>setLibraryOpen(false)}/>
        <View style={{padding:24,paddingBottom:Math.max(insets.bottom,24),backgroundColor:"#18232d",borderTopLeftRadius:24,borderTopRightRadius:24,gap:12}}>
          <Text style={{color:"white",fontSize:24,fontWeight:"800"}}>Kitaplık</Text>
          <Pressable onPress={()=>go("history")} style={{padding:18,backgroundColor:"#24343e",borderRadius:12}}><Text style={{color:"white",fontSize:17}}>Favoriler · Geçmiş · Devam Et</Text></Pressable>
          <Pressable onPress={()=>go("downloads")} style={{padding:18,backgroundColor:"#24343e",borderRadius:12}}><Text style={{color:"white",fontSize:17}}>İndirmeler</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  shell: { gap: 4 },
  summary: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  summaryCompact: { minHeight: 44 },
  identity: { flex: 1, minWidth: 0 },
  product: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  activeLine: { marginTop: 3, flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 },
  activeLabel: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  toggle: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  toggleText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  navRow: { alignItems: "center", gap: 7, paddingBottom: 4 },
  navRowCompact: { gap: 6, paddingBottom: 2 },
  tvNav: { alignItems: "center", gap: 10, paddingVertical: 8 },
  tvTarget: { minHeight: 56, minWidth: 56, paddingHorizontal: 18, borderWidth: 2, borderRadius: 14 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
