import expo.modules.legendstreamtvremote.TvFocusPolicy;
import expo.modules.legendstreamtvremote.TvFocusPolicy.Target;
import java.util.*;
/** Consumes geometry and focus IDs emitted by the real RN StageRail host tree. */
public class TvVerticalRailHost {
  public static void main(String[] args) {
    List<Target> targets=new ArrayList<>();
    for(int i=2;i<args.length;i++) {
      String[] p=args[i].split(",");
      targets.add(new Target(i,p[0],"content",p[1],Float.parseFloat(p[2]),Float.parseFloat(p[3]),Float.parseFloat(p[4]),Float.parseFloat(p[5])));
    }
    Target current=targets.stream().filter(t->t.id.equals(args[0])).findFirst().orElseThrow();
    if(args[1].equals("benchmark")) {
      long[] samples=new long[5000];int checksum=0;
      for(int i=0;i<2000;i++)TvFocusPolicy.move(current,"down",targets,"content");
      for(int i=0;i<samples.length;i++) {long start=System.nanoTime();Target t=TvFocusPolicy.move(current,"down",targets,"content");samples[i]=System.nanoTime()-start;if(t!=null)checksum+=t.tag;}
      Arrays.sort(samples);
      System.out.print("policy host ns: p50="+samples[2500]+" p95="+samples[4750]+" checksum="+checksum);return;
    }
    Target next=TvFocusPolicy.move(current,args[1],targets,"content");
    System.out.print(next==null?current.id:next.id);
  }
}
