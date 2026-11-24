/**
 * Privacy-first product analytics contracts.
 *
 * IMPORTANT: Do NOT deploy this as a public ingestion endpoint. Wire only
 * behind the existing AppDeploy authenticated backend, consent preference,
 * and a server-enforced role-scoped administration route.
 *
 * No conversation text, journal content, names, emails, IP addresses,
 * exact location, free-form props or raw identifiers are ever accepted.
 */
export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_EVENTS = Object.freeze({
 app_open: [],
 tab_view: ['tab'],
 q_open: [],
 q_message_sent: [],
 q_reply_finished: ['outcome','latency_band'],
 journey_day_open: ['day'],
 journey_day_complete: ['day'],
 journey_resume: ['day'],
 activity_open: ['activity'],
 activity_complete: ['activity'],
 coparenting_open: [],
 coparenting_tool_open: ['tool'],
 coparenting_draft_created: ['tool'],
 screen_error: ['area','error_type'],
 pricing_open: [],
 trial_cta_tapped: [],
 settings_analytics_opt_in: [],
 settings_analytics_opt_out: [],
});
export const PROPERTY_VALUES = Object.freeze({
 tab:['home','journey','q','community','my-space','resources','unknown'],
 outcome:['success','error','cancel'],
 latency_band:['under_2s','2_to_5s','5_to_10s','over_10s','unknown'],
 activity:['grounding','unsent-message','one-small-thing','child-memory','calm-reply','handover-plan'],
 tool:['pause','clear-message','handover','change','repair','child-focus'],
 area:['home','journey','q','co-parenting','settings','billing','unknown'],
 error_type:['network','auth','render','save','timeout','unknown'],
});
const MAX_EVENTS_PER_BATCH=20;
const MAX_EVENT_AGE_MS=24*60*60*1000;

export function validateAnalyticsEvent(record, now = Date.now()) {
 if (!record || typeof record!=='object' || Array.isArray(record)) return null;
 const {name,properties={},timestamp}=record;
 if(typeof name!=='string' || !Object.hasOwn(ANALYTICS_EVENTS,name))return null;
 if(typeof timestamp!=='number'||!Number.isFinite(timestamp)||Math.abs(now-timestamp)>MAX_EVENT_AGE_MS)return null;
 if(!properties||typeof properties!=='object'||Array.isArray(properties))return null;
 const permitted=ANALYTICS_EVENTS[name];
 // Reject unrecognised fields outright: never log personal free text by accident.
 if(Object.keys(properties).some(k=>!permitted.includes(k)))return null;
 const result={};
 for(const [key,value] of Object.entries(properties)){
   if(key==='day'){
     if(!Number.isInteger(value)||value<1||value>100)return null;
   }else if(!PROPERTY_VALUES[key]?.includes(value)){
     return null;
   }
   result[key]=value;
 }
 return {v:ANALYTICS_SCHEMA_VERSION,name,properties:result,timestamp};
}

/**
 * consent must be fetched from an authenticated user's current server-side
 * settings. An untrusted browser boolean is not a valid opt-in.
 */
export function prepareAnalyticsBatch(events, {serverConsent,now=Date.now()}={}) {
 if(serverConsent!==true)return {accepted:[],rejected:Array.isArray(events)?events.length:0,reason:'consent_required'};
 if(!Array.isArray(events)||events.length>MAX_EVENTS_PER_BATCH)return {accepted:[],rejected:0,reason:'invalid_batch'};
 const accepted=[]; let rejected=0;
 for(const e of events){
   const cleaned=validateAnalyticsEvent(e,now);
   if(cleaned)accepted.push(cleaned);
   else rejected++;
 }
 return {accepted,rejected};
}

export function aggregateProductAnalytics(records,{minimumGroupSize=5}={}) {
 // Only validated events should enter this function; no person-level exports.
 if(!Number.isInteger(minimumGroupSize)||minimumGroupSize<5)throw Error('Small-group threshold too low');
 const counts=new Map();
 for(const r of records){
   if(!r||!Object.hasOwn(ANALYTICS_EVENTS,r.name))continue;
   const category=r.name;
   const day=r.name.startsWith('journey_')?r.properties?.day:null;
   const key=category+'|'+(day||'all');
   counts.set(key,(counts.get(key)||0)+1);
 }
 // Applied when count-level reporting risks isolating a tiny subgroup.
 return [...counts].filter(([,count])=>count>=minimumGroupSize)
   .map(([key,count])=>{const [event,day]=key.split('|');return {event,day:day==='all'?null:Number(day),count};});
}

export function safeAnalyticsExport(rows) {
 return rows.map(row=>({event:row.event,journey_day:row.day??'',count:row.count}));
}

export const ANALYTICS_RETENTION_DAYS=90;
