package expo.modules.legendstreamtvremote;

import java.util.List;

/** Actual production directional policy; Android supplies measured rectangles and native view IDs. */
public final class TvFocusPolicy {
  public static final class Target {
    public final int tag;
    public final String id, scope, region;
    public final float x, y, width, height;
    public Target(int tag, String id, String scope, String region, float x, float y, float width, float height) {
      this.tag=tag; this.id=id; this.scope=scope; this.region=region;
      this.x=x; this.y=y; this.width=width; this.height=height;
    }
  }
  private static boolean screen(String region) {return region.equals("home")||region.equals("live")||region.equals("movies")||region.equals("series");}
  private static boolean hero(Target t) {return t.region.equals("home")&&t.id.startsWith("home-hero:");}
  private static String shelf(Target t) {
    if(!t.region.equals("home")||!t.id.startsWith("home-shelf:"))return "";
    int end=t.id.indexOf(':',11);
    return end<0?"":t.id.substring(0,end);
  }
  private static boolean more(Target t) {return !shelf(t).isEmpty()&&t.id.endsWith(":more");}
  private static boolean hasCards(Target t,List<Target> targets,String scope) {
    String row=shelf(t);
    for(Target candidate:targets)if(candidate.scope.equals(scope)&&shelf(candidate).equals(row)&&!more(candidate)&&candidate.width>0&&candidate.height>0)return true;
    return false;
  }
  public static Target move(Target current, String direction, List<Target> targets, String scope) {
    if (current == null || !current.scope.equals(scope)) return null;
    if (!(direction.equals("left") || direction.equals("right") || direction.equals("up") || direction.equals("down"))) return null;
    boolean horizontal=direction.equals("left")||direction.equals("right");
    boolean navigation=current.region.equals("navigation");
    if(navigation && direction.equals("up"))return null;
    Target best=null; double score=Double.POSITIVE_INFINITY;
    for(Target t:targets) {
      if(t.tag==current.tag || !t.scope.equals(scope) || t.width<=0 || t.height<=0)continue;
      boolean targetNavigation=t.region.equals("navigation");
      if(screen(current.region)&&screen(t.region)&&!current.region.equals(t.region))continue;
      if(navigation && horizontal && !targetNavigation)continue;
      if(navigation && direction.equals("down") && targetNavigation)continue;
      if(!navigation && (horizontal||direction.equals("down")) && targetNavigation)continue;
      String currentShelf=shelf(current), targetShelf=shelf(t);
      boolean sameShelf=!currentShelf.isEmpty()&&currentShelf.equals(targetShelf);
      boolean homeHorizontal=current.region.equals("home")&&horizontal;
      if(homeHorizontal && hero(current) && !hero(t))continue;
      if(homeHorizontal && !currentShelf.isEmpty() && (!sameShelf || !more(current)&&more(t)))continue;
      if(!horizontal && current.region.equals("home")) {
        if(hero(current)&&hero(t))continue;
        if(sameShelf) {
          boolean headerDown=more(current)&&direction.equals("down")&&!more(t);
          boolean cardUp=!more(current)&&direction.equals("up")&&more(t)&&Math.abs(t.x+t.width/2-current.x-current.width/2)<=(t.width+current.width)/2;
          if(!headerDown&&!cardUp)continue;
        }
        // DOWN enters a card, not a distant header's duplicate See All action.
        if(!sameShelf&&more(t)&&hasCards(t,targets,scope))continue;
      }
      if(navigation&&direction.equals("down")&&more(t)&&hasCards(t,targets,scope))continue;
      float dx=t.x+t.width/2-current.x-current.width/2;
      float dy=t.y+t.height/2-current.y-current.height/2;
      float primary=direction.equals("left")?-dx:direction.equals("right")?dx:direction.equals("up")?-dy:dy;
      if(primary<=1)continue;
      float overlapX=Math.min(t.x+t.width,current.x+current.width)-Math.max(t.x,current.x);
      float overlapY=Math.min(t.y+t.height,current.y+current.height)-Math.max(t.y,current.y);
      // Horizontal motion stays in its measured row. A row boundary never jumps diagonally.
      if(horizontal && !sameShelf && overlapY < Math.min(t.height,current.height)*0.5f)continue;
      if(!horizontal && overlapY > Math.min(t.height,current.height)*0.5f)continue;
      float cross=horizontal?Math.abs(dy):Math.abs(dx);
      // First choose the adjacent measured row, then the nearest column in that row.
      // Unlike a weighted Euclidean score, a remote diagonal cannot outrank the next row.
      double candidate=primary*10000d+cross;
      if(!horizontal && overlapX>0)candidate-=0.25;
      if(candidate<score || candidate==score && best!=null && t.id.compareTo(best.id)<0){best=t;score=candidate;}
    }
    return best;
  }
}
