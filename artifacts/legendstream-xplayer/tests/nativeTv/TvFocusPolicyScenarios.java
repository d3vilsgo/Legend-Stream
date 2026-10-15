import expo.modules.legendstreamtvremote.TvFocusPolicy;
import expo.modules.legendstreamtvremote.TvFocusPolicy.Target;
import java.util.*;

/** Executes the production Android directional policy on JVM; not a substitute for device focus events. */
public class TvFocusPolicyScenarios {
  static int passed=0;
  static Target t(int tag,String id,String scope,String region,float x,float y) {return new Target(tag,id,scope,region,x,y,100,70);}
  static void check(boolean condition,String name) {if(!condition) throw new AssertionError(name);passed++;System.out.println("ok native JVM "+passed+" - "+name);}
  static Target move(Target current,String dir,List<Target> targets,String scope) {return TvFocusPolicy.move(current,dir,targets,scope);}
  public static void main(String[] args) {
    Target home=t(1,"nav:home","content","navigation",0,0), live=t(2,"nav:live","content","navigation",110,0), movies=t(3,"nav:movies","content","navigation",220,0), series=t(4,"nav:series","content","navigation",330,0), settings=t(5,"nav:settings","content","navigation",440,0);
    Target a=t(10,"live:a","content","content",0,120),b=t(11,"live:b","content","content",110,120),c=t(12,"live:c","content","content",0,210),d=t(13,"live:d","content","content",110,210);
    List<Target> grid=new ArrayList<>(List.of(home,live,movies,series,settings,a,b,c,d));
    check(move(a,"up",grid,"content")==home,"Home/content top edge reaches navigation");
    check(move(home,"right",grid,"content")==live,"Home navigation reaches Live");
    check(move(live,"right",grid,"content")==movies,"Live reaches Movies");
    check(move(movies,"right",grid,"content")==series,"Movies reaches Series");
    check(move(series,"right",grid,"content")==settings,"Series reaches Settings");
    check(move(settings,"left",grid,"content")==series,"Settings returns left");
    check(move(live,"down",grid,"content")==b,"Navigation descends into actual content");
    check(move(a,"right",grid,"content")==b,"Channel row right");
    check(move(b,"left",grid,"content")==a,"Channel row left");
    check(move(a,"down",grid,"content")==c,"Poster column down");
    check(move(c,"up",grid,"content")==a,"Poster column up");
    check(move(a,"left",grid,"content")==null,"Boundary never activates arbitrary target");
    check(move(null,"down",grid,"content")==null,"Missing actual focus never guesses an OK target");
    grid.remove(d);check(move(c,"right",grid,"content")!=d,"Recycled target is excluded");
    Target page=t(14,"live:next-page","content","content",0,600);grid.add(page);
    check(move(c,"down",grid,"content")==page,"Mounted next page remains reachable after scroll");
    Target audio=t(20,"player:audio","player","player",0,100),cc=t(21,"player:cc","player","player",110,100),close=t(22,"player:close","player","player",0,20);
    grid.addAll(List.of(audio,cc,close));
    check(move(audio,"right",grid,"player")==cc,"Player option navigation");
    check(move(audio,"up",grid,"player")==close,"Player close target is reachable");
    check(move(a,"right",grid,"player")==null,"Player scope excludes catalog focus");
    check(move(audio,"down",grid,"player")==null,"Player boundary cannot escape to catalog");
    Target category=t(30,"category:one","category-drawer","player",0,100),category2=t(31,"category:two","category-drawer","player",0,200);grid.addAll(List.of(category,category2));
    check(move(category,"down",grid,"category-drawer")==category2,"Modal has independent focus scope");
    check(move(category,"up",grid,"player")==null,"Modal cannot enter player scope");
    // Measured coordinates change after scroll; policy uses the new rectangle, not cached indexes.
    Target scrolled=t(14,"live:next-page","content","content",0,300);grid.remove(page);grid.add(scrolled);
    check(move(c,"down",grid,"content")==scrolled,"Fresh scroll coordinates drive next target");
    Map<Integer,Runnable> actions=new HashMap<>();String[] screen={"home"};
    for(Target nav:List.of(home,live,movies,series,settings)) actions.put(nav.tag,()->screen[0]=nav.id.substring(4));
    Target focus=move(home,"right",grid,"content");actions.get(focus.tag).run();check(screen[0].equals("live"),"Focused Live action changes active screen");
    focus=move(focus,"right",grid,"content");actions.get(focus.tag).run();check(screen[0].equals("movies"),"Focused Movies action changes active screen");
    focus=move(focus,"right",grid,"content");actions.get(focus.tag).run();check(screen[0].equals("series"),"Focused Series action changes active screen");
    focus=move(focus,"right",grid,"content");actions.get(focus.tag).run();check(screen[0].equals("settings"),"Focused Settings action changes active screen");
    Target poster=t(40,"series:poster","content","content",440,120);grid.add(poster);
    Target selected=move(settings,"down",grid,"content");check(selected==poster,"Settings/navigation rail enters nearest mounted screen target");
    actions.put(poster.tag,()->screen[0]="series-detail");actions.get(poster.tag).run();check(screen[0].equals("series-detail"),"Poster action opens detail state");
    Target episode=t(41,"episode:one","content","content",440,210);actions.put(episode.tag,()->screen[0]="player");actions.get(episode.tag).run();check(screen[0].equals("player"),"Episode action opens playback state");
    check(a.id.equals("live:a"),"Stable content identity survives policy movement");
    Target search=t(90,"native:root:search","content","content",110,80);grid.add(search);
    check(move(live,"down",grid,"content")==search,"Legacy search target is reachable from navigation");
    check(move(search,"down",grid,"content")==b,"Legacy controls retain access to registered catalog rows");
    check(move(search,"up",grid,"content")==live,"Legacy control returns to navigation");
    System.out.println("Native JVM focus scenarios: "+passed+"/"+passed+" passed");
  }
}
