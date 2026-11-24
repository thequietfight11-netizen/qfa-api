/**
 * Aggregate-only analytics engine for private founder dashboard.
 * Input records MUST be server-validated, consented events with an internal
 * pseudonymous subject. Output NEVER includes subjects or message content.
 */
function uniqueCount(events){ return new Set(events.map(e=>e.serverSubject)).size; }
function visible(events, threshold){ return uniqueCount(events)>=threshold; }
function people(events){return uniqueCount(events);}
function eventsFor(rows,name){return rows.filter(e=>e.name===name);}
function dateKey(ts){return new Date(ts).toISOString().slice(0,10);}

export function buildFounderReport(rows,{
 from=Date.now()-7*86400000,to=Date.now(),minSubjects=5
}={}){
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw Error('Invalid period');
 if(!Number.isInteger(minSubjects)||minSubjects<5)throw Error('Minimum reporting group is five people');
 const safe=rows.filter(r=>r&&typeof r.serverSubject==='string'&&r.serverSubject
   &&typeof r.timestamp==='number'&&Number.isFinite(r.timestamp)
   &&r.timestamp>=from&&r.timestamp<=to&&typeof r.name==='string');
 const app=eventsFor(safe,'app_open');
 const q=eventsFor(safe,'q_reply_finished');
 const starts=eventsFor(safe,'journey_day_open');
 const finishes=eventsFor(safe,'journey_day_complete');
 const activity=eventsFor(safe,'activity_complete');
 const coParent=eventsFor(safe,'coparenting_tool_open');
 const peopleSet=new Set(safe.map(r=>r.serverSubject));
 const completeDay1=finishes.filter(r=>r.properties?.day===1);
 const openedDay1=starts.filter(r=>r.properties?.day===1);
 const day1Starts=new Set(openedDay1.map(r=>r.serverSubject));
 const day1Finishers=new Set(completeDay1.map(r=>r.serverSubject).filter(u=>day1Starts.has(u)));
 const dailyByPerson=new Map();
 for(const e of finishes){
   const day=e.properties?.day;
   if(!Number.isInteger(day)||day<1||day>100)continue;
   const key=e.serverSubject+'|'+dateKey(e.timestamp);
   if(!dailyByPerson.has(key))dailyByPerson.set(key,new Set());
   dailyByPerson.get(key).add(day);
 }
 const multiDayPeople=new Set([...dailyByPerson].filter(([,days])=>days.size>=2).map(([key])=>key.split('|')[0]));
 const journeyActivityUsers=new Set(starts.map(e=>e.serverSubject));
 const optionalUsers=new Set(activity.map(e=>e.serverSubject).filter(u=>journeyActivityUsers.has(u)));
 const qSuccess=q.filter(e=>e.properties?.outcome==='success');
 const qFailure=q.filter(e=>e.properties?.outcome==='error');
 const qSlow=q.filter(e=>['5_to_10s','over_10s'].includes(e.properties?.latency_band));
 const rates=(numer,denom)=>denom?Math.round(1000*numer/denom)/10:null;
 const kpi={
   activeUsers:visible(app,minSubjects)?people(app):null,
   firstDayCompletionPct:day1Starts.size>=minSubjects?rates(day1Finishers.size,day1Starts.size):null,
   multiDayUsers:multiDayPeople.size>=minSubjects?multiDayPeople.size:null,
   optionalActivityAdoptionPct:journeyActivityUsers.size>=minSubjects&&optionalUsers.size>=minSubjects?rates(optionalUsers.size,journeyActivityUsers.size):null,
   qReplySuccessPct:visible(q,minSubjects)?rates(qSuccess.length,q.length):null,
   qSlowReplyPct:visible(q,minSubjects)?rates(qSlow.length,q.length):null,
   qErrorCount:visible(qFailure,minSubjects)?qFailure.length:null,
 };
 const uniqueGroup=(items,keyFn)=>{
   const groups=new Map();
   for(const e of items){
     const key=keyFn(e);
     if(!key)continue;
     const g=groups.get(key)||{events:0,users:new Set()};
     g.events++;
     g.users.add(e.serverSubject);
     groups.set(key,g);
   }
   return [...groups].filter(([,g])=>g.users.size>=minSubjects)
     .map(([name,g])=>({name,events:g.events,users:g.users.size}))
     .sort((a,b)=>b.events-a.events);
 };
 const detail={
   journeyDayStarts:uniqueGroup(starts,e=>Number.isInteger(e.properties?.day)?String(e.properties.day):null),
   journeyDayFinishes:uniqueGroup(finishes,e=>Number.isInteger(e.properties?.day)?String(e.properties.day):null),
   optionalActivities:uniqueGroup(activity,e=>e.properties?.activity),
   coParentTools:uniqueGroup(coParent,e=>e.properties?.tool),
   qResponseTimes:uniqueGroup(q,e=>e.properties?.latency_band),
 };
 return {
   from:new Date(from).toISOString(),to:new Date(to).toISOString(),
   dataCoverage:{eligibleUsers:peopleSet.size,smallGroupsHidden:true,minSubjects},
   metrics:kpi,breakdowns:detail,
   note:'NULL means insufficient consenting users; never turn it into zero.',
 };
}
