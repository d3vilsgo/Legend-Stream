package expo.modules.legendstreamtvremote;
import java.util.LinkedHashMap;
/** Production lifecycle ticket and exact native event ownership. No Android dependency. */
public final class TvFocusStability {
  private long revision=0;
  private final LinkedHashMap<String,Boolean> released=new LinkedHashMap<>();
  public void release(String press){released.put(press,true);while(released.size()>64)released.remove(released.keySet().iterator().next());}
  public boolean lateRepeat(String press,int action,int repeat){return action==0&&repeat>0&&released.containsKey(press);}
  private final LinkedHashMap<String,Boolean> events=new LinkedHashMap<>();
  public long invalidate(){return ++revision;}
  public long schedule(){return ++revision;}
  public boolean canRestore(long ticket,boolean currentHasFocus,boolean targetValid){return ticket==revision&&!currentHasFocus&&targetValid;}
  public static String eventId(int device,long downTime,int key,int action,int repeat){return device+":"+downTime+":"+key+":"+action+":"+repeat;}
  public boolean seen(String id){return events.containsKey(id);}
  public Boolean result(String id){return events.get(id);}
  public void begin(String id){events.put(id,null);while(events.size()>128)events.remove(events.keySet().iterator().next());}
  public void finish(String id,boolean handled){events.put(id,handled);}
  public void clear(){invalidate();events.clear();released.clear();}
  public static String cause(String requested,boolean dispatching,long structuralAge,String structural){
    if(!requested.isEmpty())return requested;
    if(dispatching)return "native-input";
    if(structuralAge>=0&&structuralAge<=100)return structural+"-correlated";
    return "unknown";
  }
}
