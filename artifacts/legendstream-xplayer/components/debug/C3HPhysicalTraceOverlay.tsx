import React, { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  EMPTY_C3H_PHYSICAL_TRACE_STATE,
  projectC3HPhysicalTrace,
  type C3HPhysicalTraceState,
} from "@/lib/c3hPhysicalTraceProjection";
import { getStalkerTraceEntries, subscribeStalkerTrace } from "@/lib/stalkerPlaybackTrace";

const ms = (value: number | null) => value === null ? "..." : `${Math.round(value)} ms`;
const yesNo = (value: boolean | null) => value === null ? "-" : value ? "YES" : "NO";

function readState(): C3HPhysicalTraceState {
  try {
    return projectC3HPhysicalTrace(getStalkerTraceEntries());
  } catch {
    return { ...EMPTY_C3H_PHYSICAL_TRACE_STATE };
  }
}

function C3HPhysicalTraceOverlayImpl() {
  const [state, setState] = useState<C3HPhysicalTraceState>(readState);

  useEffect(() => {
    const refresh = () => {
      try {
        setState(readState());
      } catch {
        setState({ ...EMPTY_C3H_PHYSICAL_TRACE_STATE });
      }
    };
    refresh();
    return subscribeStalkerTrace(refresh);
  }, []);

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Text style={styles.title}>C3H TRACE</Text>
      <Text style={styles.line}>PATH: {state.path}</Text>
      <Text style={styles.line}>ROWS: {state.rows ?? "-"}</Text>
      <Text style={styles.line}>LOOKUPS: {state.lookups}</Text>
      <Text style={styles.line}>GET_ALL: {yesNo(state.getAll)}</Text>
      <Text style={styles.line}>REACQUIRE: {ms(state.reacquireMs)}</Text>
      <Text style={styles.line}>C3F: {ms(state.c3fMs)}</Text>
      <Text style={styles.line}>VLC START: {ms(state.vlcStartMs)}</Text>
      <Text style={styles.line}>TOTAL: {ms(state.totalMs)}</Text>
      <Text style={styles.line}>CMD STAGE: {state.cmdStage}</Text>
      <Text style={styles.line}>CREATE_LINK: {yesNo(state.createLink)}</Text>
      <Text style={styles.line}>VLC: {state.vlc}</Text>
    </View>
  );
}

export const C3HPhysicalTraceOverlay = memo(C3HPhysicalTraceOverlayImpl);

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 1000,
    minWidth: 210,
    maxWidth: 270,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  title: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  line: {
    color: "#ffffff",
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 14,
  },
});
