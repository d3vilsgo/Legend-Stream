import expo.modules.legendstreamtvremote.TvFocusPolicy;
import expo.modules.legendstreamtvremote.TvFocusPolicy.Target;
import java.nio.file.*;
import java.util.*;

/** Matrix rectangles come from the production TS dp calculator, not hand-picked pixel fixtures. */
public class TvResponsivePolicyScenarios {
  static Target target(int id, String region, float x, float y, float width, float height) {
    return new Target(id, "target:"+id, region.equals("player") ? "player" : "content", region, x,y,width,height);
  }
  static void expect(Target actual, Target expected) {
    if(actual!=expected) throw new AssertionError("Unexpected native directional target");
  }
  public static void main(String[] args) throws Exception {
    int count=0;
    for(String line:Files.readAllLines(Path.of(args[0]))) {
      String[] values=line.split(",");
      float[] p=new float[values.length];
      for(int i=0;i<values.length;i++) p[i]=Float.parseFloat(values[i]);
      float left=p[0], top=p[1], navWidth=p[2], target=p[3], cell=p[4], toolWidth=p[5], toolHeight=p[6], gap=p[7];
      int columns=(int)p[8], controls=(int)p[9];
      List<Target> nav=new ArrayList<>();
      for(int i=0;i<5;i++) nav.add(target(i,"navigation",left+i*(navWidth+10),top,navWidth,target));
      for(int i=0;i<4;i++) expect(TvFocusPolicy.move(nav.get(i),"right",nav,"content"),nav.get(i+1));
      List<Target> grid=new ArrayList<>(nav);
      List<Target> cards=new ArrayList<>();
      for(int i=0;i<columns*3;i++) cards.add(target(10+i,"content",left+(i%columns)*cell,top+target+24+(i/columns)*240,cell-12,220));
      grid.addAll(cards);
      expect(TvFocusPolicy.move(cards.get(0),"down",grid,"content"),cards.get(columns));
      expect(TvFocusPolicy.move(cards.get(columns),"up",grid,"content"),cards.get(0));
      if(columns>1) {
        expect(TvFocusPolicy.move(cards.get(0),"right",grid,"content"),cards.get(1));
        expect(TvFocusPolicy.move(cards.get(1),"left",grid,"content"),cards.get(0));
      }
      List<Target> dock=new ArrayList<>();
      for(int i=0;i<controls;i++) dock.add(target(100+i,"player",left+i*(toolWidth+gap),500,toolWidth,toolHeight));
      for(int i=0;i<controls-1;i++) expect(TvFocusPolicy.move(dock.get(i),"right",dock,"player"),dock.get(i+1));
      for(int i=controls-1;i>0;i--) expect(TvFocusPolicy.move(dock.get(i),"left",dock,"player"),dock.get(i-1));
      count++;
    }
    System.out.println("Native responsive JVM matrix: "+count+"/"+count+" passed");
  }
}
