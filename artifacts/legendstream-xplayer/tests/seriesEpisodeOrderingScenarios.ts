import assert from "node:assert/strict";
import { orderGoldenSeriesEpisodes, orderGoldenSeriesSeasons } from "../lib/goldenSeriesDetail";
import { orderSeriesEpisodes } from "../lib/seriesEpisodeOrder";
import { getEpisodePlaybackQueue, registerLocalEpisodeQueue, type XtreamSeriesInfo } from "../lib/xtreamCatalog";
import { stalkerSeriesEpisodeIdentity, stalkerSeriesEpisodeNumber } from "../lib/stalkerSeriesProduct";

const episode = (id: string, episodeNumber?: number) => ({ id, title: `Episode ${episodeNumber ?? "?"}`, seasonId: "1", episodeNumber });

assert.deepEqual(orderGoldenSeriesEpisodes([episode("a",1),episode("b",2),episode("c",3)]).map(x=>x.episodeNumber),[1,2,3]);
assert.deepEqual(orderGoldenSeriesEpisodes([episode("a",1),episode("b",2),episode("c",10)]).map(x=>x.episodeNumber),[1,2,10]);
assert.deepEqual(orderGoldenSeriesEpisodes([episode("a",1),episode("c",10),episode("b",2)]).map(x=>x.episodeNumber),[1,2,10]);
assert.deepEqual(orderGoldenSeriesEpisodes([episode("83921",1),episode("12004",2),episode("99901",3)]).map(x=>x.id),["83921","12004","99901"]);
assert.deepEqual(orderGoldenSeriesEpisodes([episode("opaque-z",2),episode("opaque-a",1)]).map(x=>x.id),["opaque-a","opaque-z"]);

const unknown=[episode("known-2",2),episode("unknown-a"),episode("known-1",1),episode("unknown-b")];
assert.deepEqual(orderGoldenSeriesEpisodes(unknown).map(x=>x.id),["known-1","known-2","unknown-a","unknown-b"]);
assert.equal(orderGoldenSeriesEpisodes(unknown).length,unknown.length);

const duplicate=[episode("a",2),episode("b",2),episode("c",1)];
assert.deepEqual(orderGoldenSeriesEpisodes(duplicate).map(x=>x.id),["c","a","b"]);
assert.deepEqual(orderGoldenSeriesEpisodes([episode("two",2),episode("zero",0),episode("one",1)]).map(x=>x.episodeNumber),[0,1,2]);

const seasons=[
 {id:"1",label:"Season 1",seasonNumber:1,episodes:[]},
 {id:"10",label:"Season 10",seasonNumber:10,episodes:[]},
 {id:"2",label:"Season 2",seasonNumber:2,episodes:[]},
];
assert.deepEqual(orderGoldenSeriesSeasons(seasons).map(x=>x.id),["1","2","10"]);

const source=[episode("playback-6",6),episode("playback-2",2),episode("playback-2b",2)];
const snapshot=source.map(x=>({...x}));
assert.deepEqual(orderSeriesEpisodes(source).map(x=>x.id),["playback-2","playback-2b","playback-6"]);
assert.deepEqual(source,snapshot);

const playbackRef={kind:"m3u-path",providerId:"p",path:"/series/opaque-2.ts"};
const carriers=[
 {id:"opaque-6",episodeNumber:6,playbackRef:{...playbackRef,path:"/series/opaque-6.ts"}},
 {id:"opaque-2",episodeNumber:2,playbackRef},
];
const carrierOrdered=orderSeriesEpisodes(carriers);
assert.equal(carrierOrdered[0]!.id,"opaque-2");
assert.equal(carrierOrdered[0]!.playbackRef,playbackRef);

assert.equal(stalkerSeriesEpisodeNumber({episode_id:83921,episode_num:2}),2);
assert.equal(stalkerSeriesEpisodeNumber({episode_id:83921}),undefined);
assert.equal(stalkerSeriesEpisodeNumber({episode_id:"opaque",episode:0}),0);
assert.deepEqual(stalkerSeriesEpisodeIdentity("provider","series","season","episode-id"),{
 type:"stalker-episode",providerId:"provider",seriesId:"series",seasonId:"season",episodeId:"episode-id"
});

const queueInfo:XtreamSeriesInfo={episodes:{"1":[
 {id:"id-01",episode_num:1,direct_source:"m3u-path://episode-01"},
 {id:"id-06",episode_num:6,direct_source:"m3u-path://episode-06"},
 {id:"id-08",episode_num:8,direct_source:"m3u-path://episode-08"},
 {id:"id-02",episode_num:2,direct_source:"m3u-path://episode-02"},
 {id:"id-03",episode_num:3,direct_source:"m3u-path://episode-03"},
 {id:"id-04",episode_num:4,direct_source:"m3u-path://episode-04"},
]}};
registerLocalEpisodeQueue(queueInfo);
const queue=getEpisodePlaybackQueue("m3u-path://episode-01");
assert.ok(queue);
assert.deepEqual(queue.items.map(x=>x.id),["id-01","id-02","id-03","id-04","id-06","id-08"]);
assert.equal(queue.items[queue.index+1]!.id,"id-02");
assert.equal(queue.items[2+1]!.id,"id-04");
assert.deepEqual(queue.items.map(x=>x.url),[
 "m3u-path://episode-01","m3u-path://episode-02","m3u-path://episode-03",
 "m3u-path://episode-04","m3u-path://episode-06","m3u-path://episode-08"
]);

console.log("series episode ordering scenarios: PASS");
