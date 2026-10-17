export function safeInspectorFocus(raw:string):string {
 return /^(navigation:(home|live|movies|series|settings|history|downloads)|player:(play-pause|exit|channels|audio|subtitles|codec|aspect|previous|next|pip|download|panel-close)|home:(hero|shelf|section):[0-9]+|catalog:(channel|favorite|movie|series|season|episode|category):[0-9]+|catalog:(categories|sort)|category-drawer:close|target:[0-9]+|unregistered|none)$/.test(raw)?raw:"redacted";
}
export function inspectorFocusLabel(raw:string):string {
 const safe=safeInspectorFocus(raw);
 const labels:Record<string,string>={"navigation:home":"Ana Sayfa","navigation:live":"Canlı TV","navigation:movies":"Filmler","navigation:series":"Diziler","navigation:settings":"Ayarlar","navigation:history":"Geçmiş","navigation:downloads":"İndirilenler","catalog:categories":"Kategoriler","catalog:sort":"Sırala","category-drawer:close":"Kategori kapat","none":"Yok","redacted":"Gizlenmiş hedef","unregistered":"Kayıtsız hedef"};
 if(labels[safe])return labels[safe];
 const family=safe.split(":").slice(0,-1).join(":");
 const families:Record<string,string>={"home:hero":"Hero","home:shelf":"Raf kartı","home:section":"Bölüm kartı","catalog:channel":"Kanal","catalog:favorite":"Favori","catalog:movie":"Film","catalog:series":"Dizi","catalog:season":"Sezon","catalog:episode":"Bölüm","catalog:category":"Kategori","target":"Kontrol"};
 const player:Record<string,string>={"play-pause":"Oynat/Duraklat",exit:"Çıkış",channels:"Kanallar",audio:"Ses",subtitles:"Altyazı",codec:"Çözümleme",aspect:"Oran",previous:"Önceki",next:"Sonraki",pip:"PiP",download:"İndir","panel-close":"Panel kapat"};
 if(safe.startsWith("player:"))return player[safe.slice(7)]??"Player kontrolü";
 return `${families[family]??"Kontrol"} · ${safe.split(":").at(-1)?.slice(-4)}`;
}
/** Bottom placement avoids the top navigation; top placement is used only for a bottom focused target. */
export function inspectorCorner(focusTop:number,height:number):"top"|"bottom" {return focusTop>height*0.66?"top":"bottom";}
/** Ephemeral allowlisted diagnostics. Never accepts titles, URLs or provider identifiers. */
type FocusMeta={owner?:string;expected?:string;outcome?:string;expectedVisible?:boolean;focusTop?:number;timeMs:number;inputAgeMs:number;source:string;withoutInput:boolean;delivery?:string;before?:string};
export type InspectorRecord = FocusMeta & { n:number; type:string; key:string; phase:string; before:string; after:string; screen:string; scope:string; context:string; result:string };
export class InspectorHistory {
  enabled=false; collapsed=true; history=false; page=0; screen="unknown"; focus="none"; scope="content"; context="catalog"; records:InspectorRecord[]=[]; private serial=0; private keyFocus=new Map<number,string>();
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  notify=()=>{for(const listener of this.listeners) listener();};
  toggle(enabled:boolean){this.enabled=enabled;this.collapsed=true;this.history=false;this.records=[];this.serial=0;this.keyFocus.clear();this.focus="none";this.notify();}
  add(type:string,result:string,key="",phase="",focus=this.focus,meta:FocusMeta={timeMs:0,inputAgeMs:-1,source:"js-action",withoutInput:false}){
    if(!this.enabled)return;
    this.records=[...this.records,{n:++this.serial,type,key,phase,...meta,before:meta.before??this.focus,after:focus,screen:this.screen,scope:this.scope,context:this.context,result}].slice(-20);this.focus=focus;this.notify();
  }
  observeScreen(raw:string){
    const screen=["home","live","movies","series","settings","history","downloads","player"].includes(raw)?raw:"other";
    if(screen!==this.screen){this.screen=screen;this.add("screen","Ekran state değişti");}
  }
  native(e:{kind:string;sequence:number;key:string;phase:string;handled:boolean;focus:string;scope:string;context:string;timeMs?:number;inputAgeMs?:number;beforeFocus?:string;cause?:string;withoutInput?:boolean;delivery?:string;dispatchOwner?:string;expectedFocus?:string;moveOutcome?:string;expectedVisible?:boolean;focusTop?:number}){
    if(!this.enabled)return;
    const safeFocus=safeInspectorFocus(e.focus);
    this.scope=["content","player","modal","player-panel:content","player-panel:audio","player-panel:subtitles","player-panel:codec"].includes(e.scope)?e.scope:"other";
    this.context=["catalog","player-hidden","player-controls"].includes(e.context)?e.context:"other";
    const key=["UP","DOWN","LEFT","RIGHT","OK","BACK","MENU","PLAY_PAUSE","PLAY","PAUSE","STOP","NEXT","PREVIOUS","GAMEPAD","OTHER"].includes(e.key)?e.key:"OTHER";
    const phase=["DOWN","UP","REPEAT","OTHER"].includes(e.phase)?e.phase:"";
    const bounded=(v:number|undefined,fallback:number)=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER?v:fallback;
    const sources=["native-input","mount-restore","scope-restore","scope-unblock","explicit-restore","layout-correlated","virtualization-correlated","modal-transition-correlated","scope-transition-correlated","target-registration-correlated","unknown","snapshot"];
    const meta:FocusMeta={timeMs:bounded(e.timeMs,0),inputAgeMs:bounded(e.inputAgeMs,-1),source:sources.includes(e.cause??"")?e.cause!:"unknown",withoutInput:e.withoutInput===true,delivery:["fresh","repeat","duplicate","late-repeat"].includes(e.delivery??"")?e.delivery:"fresh"};
    meta.owner=["window-delegate","native-focus","native-selection","player-semantic"].includes(e.dispatchOwner??"")?e.dispatchOwner:"unknown";
    meta.expected=safeInspectorFocus(e.expectedFocus??"none");
    meta.outcome=["not-directional","boundary","missing-focus","moved","request-failed"].includes(e.moveOutcome??"")?e.moveOutcome:"unknown";
    meta.expectedVisible=e.expectedVisible!==false;
    meta.focusTop=bounded(e.focusTop,-1);
    if(e.beforeFocus)meta.before=safeInspectorFocus(e.beforeFocus);

    if(e.kind==="snapshot")this.add("snapshot","Native odak snapshot; hareket değildir","","",safeFocus,{...meta,source:"snapshot",withoutInput:false});
    else if(e.kind==="focus")this.add("focus",safeFocus===this.focus?"Odak değişmedi":`${meta.withoutInput?"TUŞSUZ ODAK · ":""}Gerçek native odak değişti`,"","",safeFocus,meta);
    else if(e.kind==="input"){this.keyFocus.set(e.sequence,safeFocus);if(this.keyFocus.size>20)this.keyFocus.delete(this.keyFocus.keys().next().value!);this.add("input",`Native olay #${Number.isSafeInteger(e.sequence)?e.sequence:0} algılandı`,key,phase,safeFocus,{...meta,source:"native-input",withoutInput:false,before:undefined});}
    else if(e.kind==="dispatch")this.add("dispatch",`${meta.delivery==="duplicate"?"Yinelenen teslim; ":meta.delivery==="late-repeat"?"Tuş sonrası repeat bastırıldı; ":""}${e.handled?"Window işlendi":"Window devredildi"}; ${safeFocus===(this.keyFocus.get(e.sequence)??this.focus)?"odak değişmedi":"odak değişti"}; eylem kanıtı değildir`,key,phase,safeFocus,{...meta,source:"native-input",withoutInput:false,before:undefined});
  }
}
export const tvInspector=new InspectorHistory();
export function inspectorAction(action:"onPress"|"back-panel"|"back-controls"|"back-exit"|"controls-shown"|"controls-hidden"|"panel-open"|"panel-closed"|"player-mounted"|"player-unmounted") {tvInspector.add("action",action.startsWith("back-")?`player-root:${action}`:action);}
