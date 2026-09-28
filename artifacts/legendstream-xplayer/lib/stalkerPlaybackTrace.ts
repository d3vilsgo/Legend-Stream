import { safeLog } from "./safeLog";

export type StalkerTraceDetails = Record<string, string | number | boolean | null | undefined>;
export type StalkerTraceEntry = { at: number; event: string; details: Record<string, string | number | boolean | null> };
export type StalkerReacquireTriggerKind = "INITIAL" | "SOURCE_CHANGE" | "DEPENDENCY_REFRESH" | "UNKNOWN";
export type StalkerReacquireResult = "OK" | "ABORTED" | "ERROR";
const MAX_ENTRIES = 180;
const MAX_TRACE_INVOCATION_SEQUENCES = 16;
const BUFFER_MILESTONES = [0,25,50,75,100] as const;
const bufferingMilestoneByTrace = new Map<string, number>();
const invocationSequenceByTrace = new Map<string, number>();
const pendingReacquireTriggerByTrace = new Map<string, StalkerReacquireTriggerKind>();
const ALLOWED_KEYS = new Set(["playerInstanceSeq","sameCatalogIdentity","sameUri","fromKind","toKind","sameKind","sourceProducer","traceId","providerPresent","providerType","providerShortId","selectedDelegate","delegateKey","mountGeneration","channelId","itemId","seriesId","seasonId","episodeId","sourceKind","hasRuntimeSource","runtimeSourceKind","activeProviderPresent","refKind","refProviderShortId","providerMatches","found","refType","portalIdHash","hasPortalUrl","hasMac","success","rowCount","targetPortalIdHash","matchedPortalId","matchedChannelId","hasCmd","kind","hasPlayableUrl","resolvedSourceKind","resolved","stage","errorClass","scheme","sourceFingerprint","previousFingerprint","nextFingerprint","reason","previousItemId","nextItemId","bufferPercent","safeNativeCode","requestedPosition","applied","hostHash","pathExtension","hasQuery","queryKeyCount","urlLengthBucket","looksLikeTransportStream","looksLikeHls","nativeEventType","isNetworkSource","hasMediaPlayer","lookupSeq","attemptSeq","invocationSeq","requestCount","durationMs","networkMs","yieldMs","parseMs","timingSamples","authMs"]);
const SAFE_REACQUIRE_SOURCES = new Set(["EXACT_PAGE","CATEGORY","FULL_DISCOVERY"]);
const SAFE_LOOKUP_KINDS = new Set(["EXACT","CATEGORY","FULL"]);
const SAFE_LOOKUP_RESULTS = new Set(["FOUND","MISS","OK","UNSUPPORTED","TIMEOUT","ABORTED","ERROR"]);
const SAFE_ATTEMPT_KINDS = new Set(["GENRE_ID","GENRE","DUAL","NONE","UNKNOWN"]);
const SAFE_ATTEMPT_RESULTS = new Set(["FOUND","MISS","OK","COMPAT_REJECT","UNSUPPORTED","TIMEOUT","AUTH_FAILED","ABORTED","ERROR","PENDING","UNKNOWN"]);
const SAFE_REACQUIRE_TRIGGERS = new Set(["INITIAL","SOURCE_CHANGE","DEPENDENCY_REFRESH","UNKNOWN"]);
const SAFE_REACQUIRE_RESULTS = new Set(["OK","ABORTED","ERROR"]);
let sequence=0, mountSequence=0, activeTraceId:string|null=null;
let playerInstanceSequence=0;
export function nextC3MPlayerInstanceSequence(){return ++playerInstanceSequence;}
export function describeC3MSource(value?:string|null){
  if(!value)return "OTHER" as const;
  if(value.startsWith("legendstream-catalog://"))return "CATALOG_RUNTIME" as const;
  if(/^https?:\/\//i.test(value))return "HTTP_RESOLVED" as const;
  if(/^file:/i.test(value))return "LOCAL" as const;
  return "OTHER" as const;
}
export function sameC3MCatalogIdentity(a?:string|null,b?:string|null){
  return describeC3MSource(a)==="CATALOG_RUNTIME"&&describeC3MSource(b)==="CATALOG_RUNTIME"?(a===b?"YES":"NO"):"UNKNOWN";
}
let entries:StalkerTraceEntry[]=[];
const listeners=new Set<()=>void>();
function pruneInvocationSequences(){while(invocationSequenceByTrace.size>MAX_TRACE_INVOCATION_SEQUENCES){const oldest=invocationSequenceByTrace.keys().next().value;if(typeof oldest!=="string")break;invocationSequenceByTrace.delete(oldest);pendingReacquireTriggerByTrace.delete(oldest);}while(pendingReacquireTriggerByTrace.size>MAX_TRACE_INVOCATION_SEQUENCES){const oldest=pendingReacquireTriggerByTrace.keys().next().value;if(typeof oldest!=="string")break;pendingReacquireTriggerByTrace.delete(oldest);}}
export function shortSafeId(value?:string|null){if(!value)return"none";let hash=0x811c9dc5;for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193);}return(hash>>>0).toString(16).padStart(8,"0").slice(0,8);}
export function classifyPlaybackSource(value?:string|null){if(!value)return"none";if(value.startsWith("legendstream-catalog://"))return"catalog-runtime";try{const p=new URL(value).protocol.toLowerCase();if(p==="http:")return"http";if(p==="https:")return"https";}catch{}return"other";}
export function fingerprintPlaybackSource(value?:string|null){return shortSafeId(value);}
export function describePlaybackSourceSafely(value?:string|null){
  const scheme=classifyPlaybackSource(value);
  if(!value)return{scheme,sourceFingerprint:"none",hostHash:"none",pathExtension:"",hasQuery:false,queryKeyCount:0,urlLengthBucket:"0",looksLikeTransportStream:false,looksLikeHls:false};
  try{const u=new URL(value);const path=u.pathname.toLowerCase();const match=path.match(/\.([a-z0-9]{1,8})$/i);return{scheme,sourceFingerprint:fingerprintPlaybackSource(value),hostHash:shortSafeId(u.hostname),pathExtension:match?.[1]??"",hasQuery:Boolean(u.search),queryKeyCount:[...u.searchParams.keys()].length,urlLengthBucket:value.length<100?"<100":value.length<250?"100-249":value.length<500?"250-499":"500+",looksLikeTransportStream:/\.ts$/i.test(path),looksLikeHls:/\.m3u8$/i.test(path)};}catch{return{scheme,sourceFingerprint:fingerprintPlaybackSource(value),hostHash:"none",pathExtension:"",hasQuery:false,queryKeyCount:0,urlLengthBucket:value.length<100?"<100":value.length<250?"100-249":value.length<500?"250-499":"500+",looksLikeTransportStream:false,looksLikeHls:false};}
}
export function classifyStalkerTraceError(error:unknown,signal?:AbortSignal){if(signal?.aborted)return"ABORTED";const m=error instanceof Error?error.message:"";if(/provider is unavailable/i.test(m))return"PROVIDER_MISSING";if(/credentials are unavailable/i.test(m))return"CREDENTIAL_STATE_INVALID";if(/reference is unavailable/i.test(m))return"PLAYBACK_REF_MISSING";if(/no longer available/i.test(m))return"PORTAL_ID_NOT_FOUND";if(/playback command/i.test(m))return"CURRENT_CMD_MISSING";if(/playable.*link/i.test(m))return"CREATE_LINK_NO_URL";return"UNKNOWN";}
export function beginStalkerPlaybackTrace(){sequence+=1;activeTraceId=`S18C2-${String(sequence).padStart(4,"0")}`;invocationSequenceByTrace.set(activeTraceId,0);pruneInvocationSequences();return activeTraceId;}
export function getActiveStalkerTraceId(){return activeTraceId;}
export function nextStalkerReacquireInvocationSequence(traceId:string){const next=(invocationSequenceByTrace.get(traceId)??0)+1;invocationSequenceByTrace.delete(traceId);invocationSequenceByTrace.set(traceId,next);pruneInvocationSequences();return next;}
export function markNextStalkerReacquireTrigger(traceId:string,triggerKind:StalkerReacquireTriggerKind){pendingReacquireTriggerByTrace.delete(traceId);pendingReacquireTriggerByTrace.set(traceId,triggerKind);pruneInvocationSequences();}
export function consumeNextStalkerReacquireTrigger(traceId:string):StalkerReacquireTriggerKind{const triggerKind=pendingReacquireTriggerByTrace.get(traceId)??"UNKNOWN";pendingReacquireTriggerByTrace.delete(traceId);return triggerKind;}
export function nextStalkerMountGeneration(){mountSequence+=1;return mountSequence;}
export function shouldTraceStalkerBuffering(traceId:string,bufferPercent?:number){if(!Number.isFinite(bufferPercent))return false;const value=Math.max(0,Math.min(100,Number(bufferPercent)));const milestone=BUFFER_MILESTONES.reduce((best,current)=>value>=current?current:best,0);const previous=bufferingMilestoneByTrace.get(traceId);if(previous!=null&&milestone<=previous)return false;bufferingMilestoneByTrace.set(traceId,milestone);return true;}
export function traceStalker(event:string,details:StalkerTraceDetails={}){const clean:Record<string,string|number|boolean|null>={};for(const[key,value]of Object.entries(details)){if(key==="source"){if(typeof value==="string"&&SAFE_REACQUIRE_SOURCES.has(value))clean.source=value;continue;}if(key==="lookupKind"){if(typeof value==="string"&&SAFE_LOOKUP_KINDS.has(value))clean.lookupKind=value;continue;}if(key==="lookupResult"){if(typeof value==="string"&&SAFE_LOOKUP_RESULTS.has(value))clean.lookupResult=value;continue;}if(key==="attemptKind"){if(typeof value==="string"&&SAFE_ATTEMPT_KINDS.has(value))clean.attemptKind=value;continue;}if(key==="attemptResult"){if(typeof value==="string"&&SAFE_ATTEMPT_RESULTS.has(value))clean.attemptResult=value;continue;}if(key==="triggerKind"){if(typeof value==="string"&&SAFE_REACQUIRE_TRIGGERS.has(value))clean.triggerKind=value;continue;}if(key==="result"){if(typeof value==="string"&&SAFE_REACQUIRE_RESULTS.has(value))clean.result=value;continue;}if(key==="sameCatalogIdentity"&&value!=="YES"&&value!=="NO"&&value!=="UNKNOWN")continue;if((key==="fromKind"||key==="toKind")&&value!=="CATALOG_RUNTIME"&&value!=="HTTP_RESOLVED"&&value!=="LOCAL"&&value!=="OTHER")continue;if(key==="sourceProducer"&&value!=="INITIAL"&&value!=="PLAYER_SELECTION"&&value!=="UNKNOWN")continue;if(!ALLOWED_KEYS.has(key)||value===undefined)continue;if(typeof value==="string")clean[key]=value.slice(0,96);else if(typeof value==="number"&&Number.isFinite(value))clean[key]=value;else if(typeof value==="boolean"||value===null)clean[key]=value;}const entry={at:Date.now(),event:event.slice(0,80),details:clean};entries=[...entries.slice(-(MAX_ENTRIES-1)),entry];safeLog.info("R18C2_STALKER_TRACE",entry);for(const listener of listeners){try{listener();}catch{/* diagnostics are fail-open */}}}
export function getStalkerTraceEntries(){return entries.slice();}
export function clearStalkerTraceEntries(){entries=[];activeTraceId=null;invocationSequenceByTrace.clear();pendingReacquireTriggerByTrace.clear();for(const listener of listeners)listener();}
export function subscribeStalkerTrace(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function formatStalkerTrace(items=entries){return items.map(entry=>JSON.stringify(entry)).join("\n");}
