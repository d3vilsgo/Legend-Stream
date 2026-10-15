/** Ephemeral allowlisted diagnostics. Never accepts titles, URLs or provider identifiers. */
export type InspectorRecord = { n:number; type:string; key:string; phase:string; before:string; after:string; screen:string; scope:string; context:string; result:string };
export class InspectorHistory {
  enabled=false; collapsed=false; history=false; page=0; screen="unknown"; focus="none"; scope="content"; context="catalog"; records:InspectorRecord[]=[]; private serial=0; private keyFocus=new Map<number,string>();
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  notify=()=>{for(const listener of this.listeners) listener();};
  toggle(enabled:boolean){this.enabled=enabled;this.records=[];this.serial=0;this.keyFocus.clear();this.focus="none";this.notify();}
  add(type:string,result:string,key="",phase="",focus=this.focus){
    if(!this.enabled)return;
    this.records=[...this.records,{n:++this.serial,type,key,phase,before:this.focus,after:focus,screen:this.screen,scope:this.scope,context:this.context,result}].slice(-20);this.focus=focus;this.notify();
  }
  observeScreen(raw:string){
    const screen=["home","live","movies","series","settings","history","downloads","player"].includes(raw)?raw:"other";
    if(screen!==this.screen){this.screen=screen;this.add("screen","Ekran state değişti");}
  }
  native(e:{kind:string;sequence:number;key:string;phase:string;handled:boolean;focus:string;scope:string;context:string}){
    if(!this.enabled)return;
    const safeFocus=/^(navigation:(home|live|movies|series|settings|history|downloads)|player:(play-pause|exit|channels|audio|subtitles|codec|aspect|previous|next|pip|download|panel-close)|target:[0-9]+|unregistered|none)$/.test(e.focus)?e.focus:"redacted";
    this.scope=["content","player","modal"].includes(e.scope)?e.scope:"other";
    this.context=["catalog","player-hidden","player-controls"].includes(e.context)?e.context:"other";
    const key=["UP","DOWN","LEFT","RIGHT","OK","BACK","MENU","PLAY_PAUSE","PLAY","PAUSE","STOP","NEXT","PREVIOUS","GAMEPAD","OTHER"].includes(e.key)?e.key:"OTHER";
    const phase=["DOWN","UP","REPEAT","OTHER"].includes(e.phase)?e.phase:"";
    if(e.kind==="focus" || e.kind==="snapshot")this.add("focus",safeFocus===this.focus?"Odak değişmedi":"Gerçek native odak değişti","","",safeFocus);
    else if(e.kind==="input"){this.keyFocus.set(e.sequence,safeFocus);if(this.keyFocus.size>20)this.keyFocus.delete(this.keyFocus.keys().next().value!);this.add("input",`Native olay #${Number.isSafeInteger(e.sequence)?e.sequence:0} algılandı`,key,phase,safeFocus);}
    else if(e.kind==="dispatch")this.add("dispatch",`${e.handled?"Window işlendi":"Window devredildi"}; ${safeFocus===(this.keyFocus.get(e.sequence)??this.focus)?"odak değişmedi":"odak değişti"}; eylem kanıtı değildir`,key,phase,safeFocus);
  }
}
export const tvInspector=new InspectorHistory();
export function inspectorAction(action:"onPress"|"back-panel"|"back-controls"|"back-exit"|"controls-shown"|"controls-hidden"|"panel-open"|"panel-closed"|"player-mounted"|"player-unmounted") {tvInspector.add("action",action.startsWith("back-")?`player-root:${action}`:action);}
