import React, {useEffect,useReducer} from "react";
import {Platform,Text,View} from "react-native";
import {FocusButton} from "@/components/FocusButton";
import {tvInspector} from "@/lib/tvRemoteInspector";
import {setNativeInspector,subscribeNativeInspector} from "@/modules/legendstream-tv-remote";
function useInspector(){const [,update]=useReducer(n=>n+1,0);useEffect(()=>tvInspector.subscribe(update),[]);return tvInspector;}
export function TVRemoteInspectorSetting(){
 const state=useInspector();if(!Platform.isTV)return null;
 return <View style={{paddingVertical:12,gap:8}}><Text style={{color:"white",fontSize:20}}>Kumanda ve Odak Test Modu</Text>
 <FocusButton focusId="inspector:toggle" label={state.enabled?"Test modunu kapat":"Test modunu aç"} onPress={()=>{state.toggle(!state.enabled);void setNativeInspector(state.enabled);}} />
 {state.enabled?<View style={{flexDirection:"row",gap:12}}><FocusButton focusId="inspector:collapse" label={state.collapsed?"Paneli genişlet":"Paneli daralt"} onPress={()=>{state.collapsed=!state.collapsed;state.notify();}}/><FocusButton focusId="inspector:history" label={state.history?"Geçmişi gizle":"Son 20 olayı göster"} onPress={()=>{state.history=!state.history;state.notify();}}/></View>:null}
 <Text style={{color:"#cbd5e1"}}>Yalnız bellek; kapatınca temizlenir. Panel odağı almaz. Kapatma/daraltma bu ekrandan yapılır.</Text></View>;
}
export function TVRemoteInspectorOverlay(){
 const state=useInspector();
 if(!Platform.isTV||!state.enabled)return null;
 const rows=state.history?state.records:state.records.slice(-3);
 return <View pointerEvents="none" accessible={false} focusable={false} style={{position:"absolute",right:32,top:32,width:state.collapsed?290:650,padding:14,borderRadius:10,backgroundColor:"rgba(0,0,0,.78)",borderWidth:1,borderColor:"#67e8f9",zIndex:99999,elevation:999}}>
 <Text style={{color:"#67e8f9",fontSize:18,fontWeight:"700"}}>REMOTE INPUT / FOCUS · {state.screen}</Text>
 <Text style={{color:"white",fontSize:16}}>Odak: {state.focus} · scope: {state.scope}</Text>
 {!state.collapsed? <><Text style={{color:"#cbd5e1",fontSize:14}}>Tuş ≠ odak ≠ eylem · Sistemce iletilmeyen tuşlar görülemez</Text>{rows.map(r=><Text key={r.n} style={{color:r.type==="input"?"#fde047":r.type==="action"?"#86efac":"white",fontSize:13,marginTop:3}}>#{r.n} {r.type} {r.key} {r.phase} · {r.result} · {r.before} → {r.after} · {r.context} / {r.scope}</Text>)}</>:null}
 </View>;
}

export function TVRemoteInspectorCollector(){useEffect(()=>{if(!Platform.isTV)return;const sub=subscribeNativeInspector(e=>tvInspector.native(e));return ()=>{sub?.remove();tvInspector.toggle(false);void setNativeInspector(false);};},[]);return null;}
