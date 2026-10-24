import expo.modules.legendstreamtvremote.TvFocusPolicy;
import expo.modules.legendstreamtvremote.TvFocusPolicy.Target;
import expo.modules.legendstreamtvremote.TvFocusStability;
import java.util.*;
/** Actual production policy and restore/event guards. No Android renderer emulation. */
public class TvHomeReachabilityScenarios {
 static int passed=0;
 static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);passed++;}
 static Target t(int tag,String id,String region,float x,float y,float w,float h){return new Target(tag,id,"content",region,x,y,w,h);}
 static Target move(Target c,String d,List<Target> ts){return TvFocusPolicy.move(c,d,ts,"content");}
 public static void main(String[] args){
  for(float scale:new float[]{.5f,1f,1.6f,2f}){
   Target nav=t(1,"nav:home","navigation",0,0,100*scale,60*scale);
   Target hero=t(2,"home-hero:fixture","home",0,100*scale,900*scale,120*scale);
   Target otherHero=t(3,"home-hero:next","home",920*scale,100*scale,900*scale,120*scale);
   Target more=t(4,"home-shelf:continue:more","home",780*scale,244*scale,120*scale,26*scale);
   Target a=t(5,"home-shelf:continue:first","home",0,280*scale,142*scale,220*scale);
   Target b=t(6,"home-shelf:continue:second","home",160*scale,280*scale,142*scale,220*scale);
   Target end=t(7,"home-shelf:continue:end","home",780*scale,280*scale,142*scale,220*scale);
   Target next=t(8,"home-shelf:live:first","home",0,550*scale,154*scale,150*scale);
   Target stats=t(9,"home:live","home",0,1000*scale,200*scale,76*scale);
   List<Target> ts=new ArrayList<>(List.of(nav,hero,otherHero,more,a,b,end,next,stats));
   check(move(nav,"down",ts)==hero,"Navigation enters Hero");
   Target first=move(hero,"down",ts);check(first==a||first==b||first==end,"Hero enters first shelf card rather than distant See All");
   check(move(a,"up",ts)==hero,"First shelf returns to Hero");
   check(move(hero,"up",ts)==nav,"Hero returns to navigation");
   check(move(a,"right",ts)==b,"Shelf RIGHT is adjacent card");
   check(move(b,"left",ts)==a,"Shelf LEFT is adjacent card");
   check(move(end,"right",ts)==null,"Shelf end never jumps to another row or Hero");
   check(move(a,"down",ts)==next,"First shelf DOWN reaches second shelf");
   check(move(next,"up",ts)!=stats,"Second shelf UP cannot jump to bottom shortcuts");
   check(move(end,"up",ts)==more,"Header action remains reachable from its aligned card");
   check(move(more,"down",ts)==end,"Header DOWN returns to its shelf");
   check(move(hero,"right",ts)==otherHero,"Hero carousel remains horizontal");
   check(move(next,"down",ts)==stats,"Preserved section shortcuts remain reachable after shelves");
   // Re-measure the same ID after outer ScrollView reveal; no geometry-based identity replacement.
   float scroll=400*scale;
   List<Target> scrolled=new ArrayList<>();Target fresh=null;
   for(Target v:ts){Target n=v==nav?v:t(v.tag,v.id,v.region,v.x,v.y-scroll,v.width,v.height);scrolled.add(n);if(v==next)fresh=n;}
   check(fresh!=null&&fresh.id.equals(next.id)&&fresh.y>=0&&fresh.y+fresh.height<=540*scale,"Scroll preserves ID and reveals requested rectangle");
   check(move(fresh,"up",scrolled)!=null,"Fresh measured coordinates keep UP reachable after scroll");
   List<Target> removed=new ArrayList<>(ts);removed.remove(next);check(move(a,"down",removed)!=next,"Unmounted target cannot be returned");
   TvFocusStability guard=new TvFocusStability();long ticket=guard.schedule();guard.invalidate();check(!guard.canRestore(ticket,false,true),"Physical input rejects stale restore");
   String event=TvFocusStability.eventId(1,100,20,0,0);guard.begin(event);guard.finish(event,true);check(guard.seen(event)&&guard.result(event),"Duplicate key does not require a second action");
   check(!guard.seen(TvFocusStability.eventId(1,100,20,0,1)),"Long press repeat remains a distinct event");
   String press=TvFocusStability.eventId(1,100,20,0,0);guard.release(press);check(guard.lateRepeat(press,0,2),"Release rejects trailing repeat");
   int[] playback={0};Map<Integer,Runnable> actions=Map.of(a.tag,()->playback[0]++);Target focus=move(b,"left",ts);check(playback[0]==0,"Navigation never starts playback");actions.get(focus.tag).run();check(playback[0]==1&&focus.id.equals(a.id),"OK action belongs to actual focused card");
  }
  // Production Hero actions share one measured row. The pager cannot live in an
  // isolated top corner that the semantic Home policy refuses to enter vertically.
  Target watch=t(101,"home-hero:movie-7:watch","home",400,140,100,56);
  Target info=t(102,"home-hero:movie-7:info","home",510,140,150,56);
  Target pager=t(103,"home-hero:next","home",670,140,56,56);
  Target shelf=t(104,"home-shelf:Filmler:movie-7","home",400,260,142,220);
  List<Target> actions=List.of(watch,info,pager,shelf);
  check(move(watch,"right",actions)==info,"New Hero Watch RIGHT reaches Info");
  check(move(info,"right",actions)==pager,"New Hero Info RIGHT reaches inline pager");
  check(move(pager,"left",actions)==info,"New Hero pager LEFT restores Info");
  check(move(watch,"down",actions)==shelf,"New Hero Watch DOWN enters real shelf");
  check(move(shelf,"up",actions)==watch,"New shelf UP restores same Hero action");
  System.out.println("Native Home reachability: "+passed+"/"+passed+" passed; PHYSICAL_FOCUS_NOT_TESTED");
 }
}
