import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out=mkdtempSync(join(tmpdir(),'native-tv-focus-'));
try {
  execFileSync('java',['com.sun.tools.javac.Main','-d',out,
    join(root,'modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java'),
    join(root,'tests/nativeTv/TvFocusPolicyScenarios.java'),
    join(root,'tests/nativeTv/TvHomeReachabilityScenarios.java'),
    join(root,'modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusStability.java'),
    join(root,'tests/nativeTv/TvFocusStabilityScenarios.java')],{stdio:'inherit'});
  execFileSync('java',['-cp',out,'TvFocusPolicyScenarios'],{stdio:'inherit'});
  execFileSync('java',['-cp',out,'TvFocusStabilityScenarios'],{stdio:'inherit'});
  execFileSync('java',['-cp',out,'TvHomeReachabilityScenarios'],{stdio:'inherit'});
} finally {rmSync(out,{recursive:true,force:true});}
