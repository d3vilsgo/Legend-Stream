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
  public static Target move(Target current, String direction, List<Target> targets, String scope) {
    if (current == null || !current.scope.equals(scope)) return null;
    Target best=null; double score=Double.POSITIVE_INFINITY;
    // Keep horizontal navigation within the navigation rail; Down enters the current screen.
    String region = current.region.equals("navigation") && !direction.equals("down") ? "navigation" : "content";
    if (!scope.equals("content")) region="player";
    for(Target t:targets) {
      if(t.tag==current.tag || !t.scope.equals(scope) || !t.region.equals(region) || t.width<=0 || t.height<=0) continue;
      float dx=t.x+t.width/2-current.x-current.width/2, dy=t.y+t.height/2-current.y-current.height/2;
      float primary=direction.equals("left")?-dx:direction.equals("right")?dx:direction.equals("up")?-dy:dy;
      if(primary<=1) continue;
      float cross=direction.equals("left")||direction.equals("right")?Math.abs(dy):Math.abs(dx);
      double candidate=primary+cross*2.2+cross*cross/Math.max(primary,1);
      if(candidate<score || candidate==score && best!=null && t.id.compareTo(best.id)<0) { best=t; score=candidate; }
    }
    // Top edge of content has an explicit route to navigation, independent of nested ScrollViews.
    if(best==null && scope.equals("content") && current.region.equals("content") && direction.equals("up")) {
      for(Target t:targets) if(t.scope.equals(scope) && t.region.equals("navigation") && t.width>0 && t.height>0) {
        double distance=Math.abs(t.x+t.width/2-current.x-current.width/2);
        if(distance<score) {score=distance;best=t;}
      }
    }
    return best;
  }
}
