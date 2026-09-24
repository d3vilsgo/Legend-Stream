import { safeLog } from "./safeLog";

export type StalkerTraceDetails = Record<string, string | number | boolean | null | undefined>;
export type StalkerTraceEntry = { at: number; event: string; details: Record<string, string | number | boolean | null> };
const MAX_ENTRIES = 180;
const ALLOWED_KEYS = new Set(["traceId","providerPresent","providerType","providerShortId","selectedDelegate","delegateKey","mountGeneration","channelId","itemId","seriesId","seasonId","episodeId","sourceKind","hasRuntimeSource","runtimeSourceKind","activeProviderPresent","refKind","refProviderShortId","providerMatches","found","refType","portalIdHash","hasPortalUrl","hasMac","success","rowCount","targetPortalIdHash","matchedPortalId","matchedChannelId","hasCmd","kind","hasPlayableUrl","resolvedSourceKind","resolved","stage","errorClass","scheme","sourceFingerprint","previousFingerprint","nextFingerprint","reason","previousItemId","nextItemId","bufferPercent","safeNativeCode","requestedPosition","applied","hostHash","pathExtension","hasQuery","queryKeyCount","urlLengthBucket","looksLikeTransportStream","looksLikeHls"]);
let sequence=0, mountSequence=0, activeTraceId:string|null=null;
let entries:StalkerTraceEntry[]=[];
const listeners=new Set<()=>void>();
export function shortSafeId(value?:string|null){if(!value)return"none";let hash=0x811c9dc5;for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193);}return(hash>>>0).toString(16).padStart(8,"0").slice(0,8);}
export function classifyPlaybackSource(value?:string|null){if(!value)return"none";if(value.startsWith("legendstream-catalog://"))return"catalog-runtime";try{const p=new URL(value).protocol.toLowerCase();if(p==="http:")return"http";if(p==="https:")return"https";}catch{}return"other";}
export function fingerprintPlaybackSource(value?:string|null){return shortSafeId(value);}
export function describePlaybackSourceSafely(value?:string|null){
  const scheme=classifyPlaybackSource(value);
  if(!value)return{scheme,sourceFingerprint:"none",hostHash:"none",pathExtension:"",hasQuery:false,queryKeyCount:0,urlLengthBucket:"0",looksLikeTransportStream:false,looksLikeHls:false};
  try{const u=new URL(value);const path=u.pathname.toLowerCase();const match=path.match(/\.([a-z0-9]{1,8})$/i);return{scheme,sourceFingerprint:fingerprintPlaybackSource(value),hostHash:shortSafeId(u.hostname),pathExtension:match?.[1]??"",hasQuery:Boolean(u.search),queryKeyCount:[...u.searchParams.keys()].length,urlLengthBucket:value.length<100?"<100":value.length<250?"100-249":value.length<500?"250-499":"500+",looksLikeTransportStream:/\.ts$/i.test(path),looksLikeHls:/\.m3u8$/i.test(path)};}catch{return{scheme,sourceFingerprint:fingerprintPlaybackSource(value),hostHash:"none",pathExtension:"",hasQuery:false,queryKeyCount:0,urlLengthBucket:value.length<100?"<100":value.length<250?"100-249":value.length<500?"250-499":"500+",looksLikeTransportStream:false,looksLikeHls:false};}
}
export function classifyStalkerTraceError(error:unknown,signal?:AbortSignal){if(signal?.aborted)return"ABORTED";const m=error instanceof Error?error.message:"";if(/provider is unavailable/i.test(m))return"PROVIDER_MISSING";if(/credentials are unavailable/i.test(m))return"CREDENTIAL_STATE_INVALID";if(/reference is unavailable/i.test(m))return"PLAYBACK_REF_MISSING";if(/no longer available/i.test(m))return"PORTAL_ID_NOT_FOUND";if(/playback command/i.test(m))return"CURRENT_CMD_MISSING";if(/playable.*link/i.test(m))return"CREATE_LINK_NO_URL";return"UNKNOWN";}
export function beginStalkerPlaybackTrace(){sequence+=1;activeTraceId=`S18C2-${String(sequence).padStart(4,"0")}`;return activeTraceId;}
export function getActiveStalkerTraceId(){return activeTraceId;}
export function nextStalkerMountGeneration(){mountSequence+=1;return mountSequence;}
export function traceStalker(event:string,details:StalkerTraceDetails={}){const clean:Record<string,string|number|boolean|null>={};for(const[key,value]of Object.entries(details)){if(!ALLOWED_KEYS.has(key)||value===undefined)continue;if(typeof value==="string")clean[key]=value.slice(0,96);else if(typeof value==="number"&&Number.isFinite(value))clean[key]=value;else if(typeof value==="boolean"||value===null)clean[key]=value;}const entry={at:Date.now(),event:event.slice(0,80),details:clean};entries=[...entries.slice(-(MAX_ENTRIES-1)),entry];safeLog.info("R18C2_STALKER_TRACE",entry);for(const listener of listeners)listener();}
export function getStalkerTraceEntries(){return entries.slice();}
export function clearStalkerTraceEntries(){entries=[];activeTraceId=null;for(const listener of listeners)listener();}
export function subscribeStalkerTrace(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function formatStalkerTrace(items=entries){return items.map(entry=>JSON.stringify(entry)).join("\n");}
