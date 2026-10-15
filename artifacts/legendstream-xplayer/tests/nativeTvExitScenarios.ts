import assert from 'node:assert/strict';
import { persistBeforePlayerExit } from '../lib/playerExitPersistence';
import { advancePlayerBack } from '../lib/playerRemoteOwnership';
async function main() {
  await persistBeforePlayerExit(()=>new Promise<void>(()=>{}),true,5);
  process.stdout.write('ok TV exit 1 - pending persistence cannot trap native TV exit\n');
  let release!:()=>void;
  let finished=false;
  const mobile=persistBeforePlayerExit(()=>new Promise<void>((resolve)=>{release=resolve;}),false,1).then(()=>{finished=true;});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(finished,false);
  release();await mobile;assert.equal(finished,true);
  process.stdout.write('ok TV exit 2 - phone still awaits persistence completion\n');
  await assert.rejects(()=>persistBeforePlayerExit(async()=>{throw new Error('storage unavailable');},true,5),/storage unavailable/);
  process.stdout.write('ok TV exit 3 - storage errors reach the existing exit catch\n');
  let saves=0;await persistBeforePlayerExit(async()=>{saves++;},true,100);assert.equal(saves,1);
  process.stdout.write('ok TV exit 4 - successful save occurs exactly once\n');
  const state={panel:true,controls:true};
  assert.deepEqual([advancePlayerBack(state,true),advancePlayerBack(state,true),advancePlayerBack(state,true)],['panel','controls','exit']);
  process.stdout.write('ok TV exit 5 - three native Back presses advance without waiting for React commit\n');
  assert.equal(advancePlayerBack({panel:false,controls:true},false),'exit');
  process.stdout.write('ok TV exit 6 - phone Back keeps direct exit behavior\nNative TV exit scenarios: 6/6 passed\n');
}
void main();
