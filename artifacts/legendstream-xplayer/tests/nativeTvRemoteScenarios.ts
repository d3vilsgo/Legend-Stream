import { nativeTvRegion } from "../lib/nativeTvRegion";
import assert from 'node:assert/strict';
import { claimPlayerBack, hasPlayerBackOwner, resolvePlayerBack } from '../lib/playerRemoteOwnership';
import { resolveTvRemoteAction as action } from '../lib/tvPlayerRemote';
import { resolveTVPreviewFocusTarget } from '../lib/tvPreviewFocus';
let passed = 0;
function test(name: string, check: () => void) { check(); passed++; process.stdout.write(`ok native TV ${passed} - ${name}\n`); }
test('panel Back has priority over visible controls', () => assert.equal(resolvePlayerBack(true, true), 'panel'));
test('controls Back hides controls', () => assert.equal(resolvePlayerBack(false, true), 'controls'));
test('hidden controls Back exits', () => assert.equal(resolvePlayerBack(false, false), 'exit'));
test('empty panel still owns Back', () => assert.equal(resolvePlayerBack(true, false), 'panel'));
test('catalog cannot own Back while any player lives', () => {
  assert.equal(hasPlayerBackOwner(), false);
  const release1 = claimPlayerBack(); const release2 = claimPlayerBack();
  assert.equal(hasPlayerBackOwner(), true); release1(); release1();
  assert.equal(hasPlayerBackOwner(), true); release2(); assert.equal(hasPlayerBackOwner(), false);
});
for (const [key, code, live, paused, visible, expected] of [
  ['select',23,true,false,false,'reveal'], ['select',23,true,false,true,'none'],
  ['playPause',85,true,false,false,'togglePause'], ['playPause',126,true,false,false,'none'],
  ['playPause',126,true,true,false,'togglePause'], ['playPause',127,false,true,true,'none'],
  ['playPause',127,false,false,true,'togglePause'], ['stop',86,true,false,true,'exit'],
  ['menu',82,true,false,true,'codec'], ['up',19,true,false,false,'previous'],
  ['down',20,true,false,false,'next'], ['left',21,false,false,false,'seekBack'],
  ['right',22,false,false,false,'seekForward'], ['next',87,false,false,true,'next'],
  ['previous',88,true,false,true,'previous'], ['left',21,true,false,false,'reveal'],
  ['up',19,false,false,false,'reveal'],
] as const) test(`${key}/${code} live=${live} paused=${paused} visible=${visible}`, () => assert.equal(action(key,code,live,paused,visible), expected));
const entry = (id: string, x: number, y: number) => ({ id, bounds: { x,y,width:100,height:80 }, press() {}, setFocused() {} });
const grid = [entry('a',0,0),entry('b',110,0),entry('c',0,90),entry('d',110,90)];
test('poster row right neighbor', () => assert.equal(resolveTVPreviewFocusTarget(grid[0],'right',grid)?.id,'b'));
test('poster column down neighbor', () => assert.equal(resolveTVPreviewFocusTarget(grid[0],'down',grid)?.id,'c'));
test('no target retains boundary instead of random selection', () => assert.equal(resolveTVPreviewFocusTarget(grid[0],'left',grid), null));
test('native target identities classify independent screen regions',()=>{
 for(const [id,region] of [['nav:live','navigation'],['home-hero:a','home'],['home-shelf:a','home'],['live:a','live'],['live-favorite:a','live'],['vod:a','movies'],['stalker:vod:a','movies'],['series:a','series'],['episode:a','series']])assert.equal(nativeTvRegion(id!),region);
 assert.equal(nativeTvRegion('catalog:sort'),'content');
});
process.stdout.write(`Native TV remote scenarios: ${passed}/${passed} passed\n`);
