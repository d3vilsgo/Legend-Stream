import Constants from "expo-constants";
import React from "react";
import { Text, View } from "react-native";
/** Android versionCode comes from the installed native package, not the base app.json multiplier. */
export function BuildIdentity() {
 const code=Constants.platform?.android?.versionCode;
 const sha=process.env.EXPO_PUBLIC_GIT_SHA || "Geliştirme / SHA tanımlı değil";
 return <View style={{padding:16,marginVertical:12,borderWidth:1,borderColor:"#40515a",borderRadius:12}}><Text selectable style={{color:"#b7c8d0",fontSize:14}}>Test sürümü · {Constants.expoConfig?.version ?? "Bilinmiyor"}{"\n"}versionCode: {code ?? "Native paket bilgisi yok"}{"\n"}Kaynak SHA: {sha}</Text></View>;
}
