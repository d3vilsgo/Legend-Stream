import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  TVPreviewPressable,
  useTVPreviewFocus,
} from "@/components/tvPreview/TVPreviewFocus";
/** Presentation only: category IDs, ordering and paging remain owned by the catalog. */
export function CategoryPicker({
  items,
  selected,
  disabled = false,
  onSelect,
}: {
  items: readonly { id: string; title: string }[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const insets = useSafeAreaInsets(),
    focus = useTVPreviewFocus();
  const filtered = useMemo(
    () =>
      items.filter((item) =>
        item.title
          .toLocaleLowerCase("tr")
          .includes(query.trim().toLocaleLowerCase("tr")),
      ),
    [items, query],
  );
  useEffect(() => {
    if (!open) return;
    const pop = focus.pushFocusScope("category-picker"),
      back = focus.registerBackAction(() => setOpen(false));
    return () => {
      back();
      pop();
    };
  }, [open, focus.pushFocusScope, focus.registerBackAction]);
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [disabled]);
  return (
    <>
      <TVPreviewPressable
        eliteVisual
        disabled={disabled}
        accessibilityLabel="Kategori seç"
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{
          marginHorizontal: 18,
          marginTop: 10,
          alignSelf: "flex-start",
          maxWidth: "90%",
          padding: 12,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: "#45615e",
          backgroundColor: "#173333",
        }}
      >
        <Text numberOfLines={1} style={{ color: "#67e8d1", fontWeight: "700" }}>
          {items.find((item) => item.id === selected)?.title ?? "Tümü"} ⌄
        </Text>
      </TVPreviewPressable>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        onShow={() => {
          if (Platform.isTV) void focus.modalShown?.("category-picker");
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0009",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            accessibilityLabel="Kategorileri kapat"
            style={{ flex: 1 }}
            onPress={() => setOpen(false)}
          />
          <View
            style={{
              maxHeight: "78%",
              backgroundColor: "#17222b",
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 23,
                fontWeight: "800",
                marginBottom: 12,
              }}
            >
              Kategoriler
            </Text>
            <TextInput
              accessibilityLabel="Kategori ara"
              value={query}
              onChangeText={setQuery}
              placeholder="Kategori ara…"
              placeholderTextColor="#a7b8c1"
              style={{
                color: "white",
                backgroundColor: "#25343f",
                borderRadius: 12,
                padding: 14,
                marginBottom: 12,
              }}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={16}
              maxToRenderPerBatch={20}
              windowSize={7}
              ListEmptyComponent={
                <Text style={{ color: "white" }}>Kategori bulunamadı</Text>
              }
              renderItem={({ item }) => (
                <TVPreviewPressable
                  eliteVisual
                  focusScope="category-picker"
                  focusId={`category-picker:${item.id}`}
                  hasTVPreferredFocus={item.id === selected}
                  accessibilityState={{ selected: item.id === selected }}
                  onPress={() => {
                    if (disabled) return;
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    marginBottom: 6,
                    backgroundColor:
                      item.id === selected ? "#21534e" : "#202f39",
                  }}
                >
                  <Text
                    style={{
                      color: item.id === selected ? "#67e8d1" : "white",
                      fontSize: 16,
                    }}
                  >
                    {item.id === selected ? "✓ " : ""}
                    {item.title}
                  </Text>
                </TVPreviewPressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
