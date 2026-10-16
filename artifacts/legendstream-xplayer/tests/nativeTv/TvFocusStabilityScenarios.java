import expo.modules.legendstreamtvremote.TvFocusStability;
public class TvFocusStabilityScenarios {
 static int n=0;static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);System.out.println("ok stability "+(++n)+" - "+name);}
 public static void main(String[]args){
  TvFocusStability p=new TvFocusStability();
  long initial=p.schedule();check(p.canRestore(initial,false,true),"explicit initial target can restore");
  p.invalidate();check(!p.canRestore(initial,false,true),"physical input cancels delayed restore");
  long a=p.schedule(),b=p.schedule();check(!p.canRestore(a,false,true)&&p.canRestore(b,false,true),"coalesced restore keeps newest scope ticket");
  check(!p.canRestore(b,true,true),"valid current focus survives layout or rerender");
  check(!p.canRestore(b,false,false),"unmounted or changed target cannot restore");
  p.invalidate();check(!p.canRestore(b,false,true),"virtualization invalidates captured target");
  long modal=p.schedule();p.invalidate();long catalog=p.schedule();check(!p.canRestore(modal,false,true)&&p.canRestore(catalog,false,true),"modal pop rejects previous scope job");
  String down=TvFocusStability.eventId(1,100,20,0,0);int moves=0;
  for(int i=0;i<2;i++){if(!p.seen(down)){p.begin(down);moves++;p.finish(down,true);}}
  check(moves==1,"same DOWN delivered twice moves once");check(Boolean.TRUE.equals(p.result(down)),"duplicate owner returns original handled result");
  String nested=TvFocusStability.eventId(1,200,20,0,0);p.begin(nested);check(p.seen(nested)&&p.result(nested)==null,"nested callback detected before native action repeats");p.finish(nested,false);check(Boolean.FALSE.equals(p.result(nested)),"unhandled result stays false");
  for(int repeat=1;repeat<=4;repeat++){String id=TvFocusStability.eventId(1,100,20,0,repeat);if(!p.seen(id)){p.begin(id);moves++;p.finish(id,true);}}
  check(moves==5,"long press retains distinct natural repeats");
  String up=TvFocusStability.eventId(1,100,20,1,0);p.begin(up);p.finish(up,true);p.release(down);check(moves==5,"UP never asks for directional movement");
  check(p.lateRepeat(down,0,5),"repeat delivered after release is rejected");
  check(!p.lateRepeat(TvFocusStability.eventId(1,300,20,0,0),0,1),"new physical press may repeat");
  check(!down.equals(TvFocusStability.eventId(2,100,20,0,0)),"independent input devices are not deduplicated together");
  check(TvFocusStability.cause("mount-restore",false,0,"layout").equals("mount-restore"),"explicit programmatic cause outranks layout correlation");
  check(TvFocusStability.cause("",true,0,"layout").equals("native-input"),"synchronous native input cause");
  check(TvFocusStability.cause("",false,20,"virtualization").equals("virtualization-correlated"),"recent detach only claims correlation");
  check(TvFocusStability.cause("",false,2000,"layout").equals("unknown"),"idle unexplained focus is not blamed on old layout");
  p.clear();check(!p.seen(down)&&!p.canRestore(catalog,false,true),"teardown clears event ownership and pending jobs");
  System.out.println("Native stability scenarios: "+n+"/"+n+" passed");
 }
}
