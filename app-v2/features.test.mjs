import test from 'node:test';
import assert from 'node:assert/strict';
import {
 JOURNEY_LENGTH, QUICK_ACTIVITIES,validateProgress,nextAvailableDay,
 completeJourneyDay,recordOptionalActivity,journeyOverview,nextStepChoices
} from './journey.mjs';
import {buildCalmReply,CO_PARENTING_TOOLS,HANDOVER_PREP,WHEN_CONTACT_IS_LIMITED} from './co-parenting.mjs';
import {buildFounderReport} from './report.mjs';
import {prepareAnalyticsBatch,validateAnalyticsEvent,aggregateProductAnalytics,ANALYTICS_EVENTS,ANALYTICS_RETENTION_DAYS} from './analytics.mjs';

test('100-day journey allows completing multiple days in one calendar day',()=>{
 let state={completedDays:[],optionalActivityCounts:{}};
 for(let day=1;day<=5;day++){
   state=completeJourneyDay(state,day);
   assert.equal(state.completedDay,day);
   assert.equal(state.nextDay,day+1);
 }
 assert.equal(journeyOverview(state).completedCount,5);
 assert.equal(nextStepChoices(state).primary.label,'Continue to Day 6');
 assert.equal(journeyOverview(state).canContinueToday,true);
});

test('no time-gating; complete all hundred days and return safe finished state',()=>{
 let state={};
 for(let day=1;day<=JOURNEY_LENGTH;day++)state=completeJourneyDay(state,day);
 assert.equal(journeyOverview(state).complete,true);
 assert.equal(journeyOverview(state).nextDay,null);
 assert.equal(nextStepChoices(state).primary,null);
 assert.equal(journeyOverview(state).remainingCount,0);
});

test('revisiting day and optional activities never accidentally advance progress',()=>{
 let state=completeJourneyDay({},1);
 const rechecked=completeJourneyDay(state,1);
 assert.equal(rechecked.alreadyCompleted,true);
 state=recordOptionalActivity(rechecked,'grounding');
 assert.equal(nextAvailableDay(state),2);
 assert.equal(journeyOverview(state).optionalActivityCount,1);
 assert.throws(()=>completeJourneyDay(state,4),/previous journey day/);
 assert.throws(()=>recordOptionalActivity(state,'secret'),/Unknown activity/);
});

test('unexpected journey input is cleaned and always bounded',()=>{
 const clean=validateProgress({completedDays:[2,2,1,-10,999,1.5,'3'],optionalActivityCounts:{grounding:12,arbitrary:12}});
 assert.deepEqual(clean.completedDays,[1,2]);
 assert.equal(clean.optionalActivityCounts.grounding,12);
 assert.equal(clean.optionalActivityCounts.arbitrary,undefined);
});

test('co-parenting provides practical, balanced tools and no-contact options',()=>{
 assert.equal(CO_PARENTING_TOOLS.length,6);
 assert.ok(HANDOVER_PREP.length>=3);
 assert.ok(WHEN_CONTACT_IS_LIMITED.length>=2);
 const draft=buildCalmReply({
  topic:'Regarding Saturday collection',
  arrangement:'I can collect at the agreed time',
  request:'Please let me know if anything has changed'
 });
 assert.match(draft.draft,/Saturday collection/);
 assert.match(draft.disclaimer,/not legal/);
 assert.throws(()=>buildCalmReply({topic:'',request:'yes',arrangement:''}),/required/);
});

test('analytics disabled without server-side opt-in',()=>{
 const now=Date.now();
 const event={name:'journey_day_complete',properties:{day:5},timestamp:now};
 const result=prepareAnalyticsBatch([event],{serverConsent:false,now});
 assert.equal(result.accepted.length,0);
 assert.equal(result.reason,'consent_required');
});

test('analytics allows typed app activity but never messages or identifying fields',()=>{
 const now=Date.now();
 const accepted={name:'journey_day_complete',properties:{day:5},timestamp:now};
 assert.equal(validateAnalyticsEvent(accepted,now).name,'journey_day_complete');
 for(const extra of [{text:'My private thoughts'},{email:'user@example.com'},{message:'Some private message'},{ip:'1.2.3.4'},{screen:'journal_text'}]){
   assert.equal(validateAnalyticsEvent({...accepted,properties:{day:5,...extra}},now),null);
 }
 assert.equal(validateAnalyticsEvent({name:'q_reply_finished',properties:{outcome:'success',latency_band:'2_to_5s'},timestamp:now},now).name,'q_reply_finished');
 assert.equal(validateAnalyticsEvent({...accepted,properties:{day:101}},now),null);
 assert.equal(validateAnalyticsEvent({...accepted,timestamp:now-3*24*60*60*1000},now),null);
});

test('analytics allows only an explicit event allowlist and short batches',()=>{
 const now=Date.now();
 assert.equal(validateAnalyticsEvent({name:'journal_saved_full_text',properties:{},timestamp:now},now),null);
 const events=Array(21).fill({name:'app_open',timestamp:now,properties:{}});
 assert.equal(prepareAnalyticsBatch(events,{serverConsent:true,now}).reason,'invalid_batch');
 assert.equal(ANALYTICS_RETENTION_DAYS,90);
 assert.ok(Object.keys(ANALYTICS_EVENTS).length>=14);
});

test('small analytics groups are suppressed from admin summaries',()=>{
 const now=Date.now();
 const a=Array.from({length:6},(_,i)=>({name:'q_open',properties:{},timestamp:now,serverSubject:'anon_'+i}));
 const b=Array.from({length:3},(_,i)=>({name:'journey_day_complete',properties:{day:4},timestamp:now,serverSubject:'anon_'+i}));
 const rows=aggregateProductAnalytics([...a,...b]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].event,'q_open');
 assert.equal(rows[0].count,6);
 assert.equal(aggregateProductAnalytics(Array.from({length:10},()=>({name:'q_open',properties:{},serverSubject:'same_dad'}))).length,0);
 assert.throws(()=>aggregateProductAnalytics(a,{minimumGroupSize:1}),/threshold/);
});

test('founder report counts distinct people and same-day multiple journey days',()=>{
 const now=Date.now();
 const rows=[];
 for(let i=0;i<6;i++){
   const subject='user_'+i;
   rows.push({name:'app_open',serverSubject:subject,timestamp:now,properties:{}});
   rows.push({name:'journey_day_open',serverSubject:subject,timestamp:now,properties:{day:1}});
   rows.push({name:'journey_day_complete',serverSubject:subject,timestamp:now,properties:{day:1}});
   rows.push({name:'journey_day_complete',serverSubject:subject,timestamp:now+1000,properties:{day:2}});
   rows.push({name:'q_reply_finished',serverSubject:subject,timestamp:now,properties:{outcome:'success',latency_band:'2_to_5s'}});
 }
 const r=buildFounderReport(rows,{from:now-1000,to:now+3000});
 assert.equal(r.metrics.activeUsers,6);
 assert.equal(r.metrics.multiDayUsers,6);
 assert.equal(r.metrics.firstDayCompletionPct,100);
 assert.equal(r.metrics.qReplySuccessPct,100);
 assert.equal(r.breakdowns.journeyDayFinishes.find(x=>x.name==='2').users,6);
 assert.equal(JSON.stringify(r).includes('user_'),false);
});

test('founder report suppresses one-person clickstorms and sensitive small groups',()=>{
 const now=Date.now();
 const rows=Array.from({length:200},()=>({name:'coparenting_tool_open',serverSubject:'only_one',timestamp:now,properties:{tool:'pause'}}));
 const r=buildFounderReport(rows,{from:now-1000,to:now+1000});
 assert.equal(r.metrics.activeUsers,null);
 assert.deepEqual(r.breakdowns.coParentTools,[]);
 assert.throws(()=>buildFounderReport(rows,{minSubjects:1}),/five people/);
});
