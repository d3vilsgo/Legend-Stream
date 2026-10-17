import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { nativeTvLayout, tvGridAnchorRow, type TvWindow } from '../lib/nativeTvResponsive';
import { resolveTVPreviewFocusTarget, type TVPreviewFocusEntry } from '../lib/tvPreviewFocus';
import { resolvePlayerBack } from '../lib/playerRemoteOwnership';
import { resolveTvRemoteAction } from '../lib/tvPlayerRemote';
const windows = [[960,540], [1280,720], [1920,1080], [1536,864]] as const;
const fonts = [.85,1,1.3,1.6,2];
const edges: Array<Partial<TvWindow>> = [{}, { safeArea: {left:48,right:32,top:24,bottom:40} },
  { overscan: {left:72,right:72,top:40,bottom:40}, safeArea: {left:16,top:8} }];
let scenarios = 0;
const nativeFixtures: string[] = [];
for (const [width,height] of windows) for (const fontScale of fonts) for (const extra of edges) for (const count of [3,8,16,24]) {
  const input: TvWindow = {width,height,fontScale,...extra};
  const m = nativeTvLayout(input,count);
  assert(m.left >= (extra.safeArea?.left ?? 0));
  assert(m.top >= (extra.safeArea?.top ?? 0));
  assert.equal(m.usableWidth, width-m.left-m.right);
  assert(m.target >= 56 && m.icon >= 26);
  assert(m.toolWidth >= 56 && m.toolWidth <= m.usableWidth);
  assert(m.toolHeight >= m.icon + (m.labelFont+m.metaFont)*fontScale*1.3);
  assert(m.centerTop >= m.top+m.target);
  assert(m.centerTop+m.playSize < height-m.bottom-m.dockHeight-64, `tiers overlap ${JSON.stringify(input)}`);
  assert(m.panelWidth <= m.usableWidth);
  assert(m.columns >= 1 && m.columns <= 12);
  const cell = m.usableWidth/m.columns;
  nativeFixtures.push([m.left,m.top,m.navWidth,m.target,cell,m.toolWidth,m.toolHeight,m.gap,m.columns,count].join(","));
  assert(cell >= 144);
  const labels = Array.from({length:count}, (_,i)=>`Çok uzun Türkçe kategori ve içerik başlığı — seçenek ${i}`);
  const selected: string[] = [];
  const entries: TVPreviewFocusEntry[] = labels.map((label,i)=>({id:`player:action:${i}`,
    bounds:{x:m.left+m.gutter+i*(m.toolWidth+m.gap),y:height-m.bottom-m.toolHeight,width:m.toolWidth,height:m.toolHeight},
    press:()=>selected.push(label),setFocused(){} }));
  let focus = entries[0];
  for (let i=0;i<count;i++) {
    assert.equal(focus.id,entries[i].id);
    focus.press(); assert.equal(selected.at(-1),labels[i]);
    if(i<count-1) focus=resolveTVPreviewFocusTarget(focus,'right',entries)!;
  }
  for (let i=count-1;i>0;i--) focus=resolveTVPreviewFocusTarget(focus,'left',entries)!;
  assert.equal(focus.id,entries[0].id);
  assert.equal(resolveTVPreviewFocusTarget(focus,'left',entries),null);
  if(count===24) assert(m.dockScrolls);
  const grid: TVPreviewFocusEntry[] = Array.from({length:m.columns*3},(_,i)=>({id:`vod:${i}`,
    bounds:{x:m.left+i%m.columns*cell,y:100+Math.floor(i/m.columns)*240,width:cell-12,height:220},press(){},setFocused(){} }));
  assert.equal(resolveTVPreviewFocusTarget(grid[0],'down',grid)?.id,grid[m.columns].id);
  assert.equal(resolveTVPreviewFocusTarget(grid[m.columns],'up',grid)?.id,grid[0].id);
  if(m.columns>1) {
    assert.equal(resolveTVPreviewFocusTarget(grid[0],'right',grid)?.id,grid[1].id);
    assert.equal(resolveTVPreviewFocusTarget(grid[1],'left',grid)?.id,grid[0].id);
  }
  assert.equal(tvGridAnchorRow(grid.at(-1)!.id,grid.map(x=>x.id),m.columns),2);
  scenarios++;
}
assert.equal(tvGridAnchorRow('missing',['vod:1'],4),null);
assert.equal(tvGridAnchorRow(null,['vod:1'],4),null);
assert.equal(tvGridAnchorRow('vod:8',Array.from({length:12},(_,i)=>`vod:${i}`),3),2);
assert.equal(tvGridAnchorRow('vod:8',Array.from({length:12},(_,i)=>`vod:${i}`),5),1);
assert.equal(resolveTvRemoteAction('select',23,false,false,false),'reveal');
assert.equal(resolvePlayerBack(true,true),'panel');
assert.equal(resolvePlayerBack(false,true),'controls');
assert.equal(resolvePlayerBack(false,false),'exit');
assert(nativeTvLayout({width:960,height:540},24).toolWidth < nativeTvLayout({width:1920,height:1080},3).toolWidth);
assert.deepEqual(nativeTvLayout({width:1280,height:720}),nativeTvLayout({width:1280,height:720,fontScale:1}));
process.stdout.write(`Native TV responsive matrix: ${scenarios}/${scenarios} passed (4 dp windows × 5 font scales × 3 inset profiles × 4 control counts).\n`);

// Execute Android production directional logic with the same computed matrix.
// This cannot simulate requestFocus, ScrollView reveal, font rendering or firmware events.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'tv-responsive-'));
try {
  const fixtures = join(out, 'dp.csv');
  writeFileSync(fixtures, nativeFixtures.join('\n'));
  execFileSync('java', ['com.sun.tools.javac.Main', '-d', out,
    join(root, 'modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java'),
    join(root, 'tests/nativeTv/TvResponsivePolicyScenarios.java')], {stdio:'inherit'});
  execFileSync('java', ['-cp', out, 'TvResponsivePolicyScenarios', fixtures], {stdio:'inherit'});
} finally { rmSync(out, {recursive:true,force:true}); }
