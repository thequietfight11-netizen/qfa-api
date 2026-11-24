/**
 * Co-parenting tools. Entirely on-device text templates / transformations;
 * never send a drafted message to analytics or an external AI without consent.
 */
export const CO_PARENTING_TOOLS = [
 {id:'pause',title:'Pause before replying',minutes:2,description:'Step away from the message, breathe and choose what actually needs answering.'},
 {id:'clear-message',title:'Write a calm reply',minutes:5,description:'Draft a short response focused on a practical arrangement, not a disagreement.'},
 {id:'handover',title:'Handover checklist',minutes:4,description:'Plan timings, belongings and one small thing to help the children feel settled.'},
 {id:'change',title:'Plans have changed',minutes:4,description:'Separate what changed from what needs agreeing, without jumping to blame.'},
 {id:'repair',title:'After a difficult conversation',minutes:3,description:'Decide whether a response is needed and what can wait.'},
 {id:'child-focus',title:'Keep children out of the middle',minutes:3,description:'Think about what helps the children feel safe and free from adult disagreements.'},
];

export function buildCalmReply({topic,arrangement,request}) {
 const parts=[topic,arrangement,request];
 if(parts.some(x => typeof x!=='string' || x.trim().length>300)) throw new Error('Keep each section brief');
 const [subject,detail,ask]=parts.map(x=>x.trim());
 if(!subject || !ask) throw new Error('A topic and practical request are required');
 // We intentionally do not invent commitments or force an apology.
 const reply = [subject + '.', detail ? detail + '.' : '', ask + '.']
   .filter(Boolean).join(' ').replace(/\.\./g,'.');
 return {
  draft:reply,
  reviewPrompt:'Read it once more. Is it factual, brief, child-focused and something you are comfortable sending?',
  disclaimer:'This is a writing aid, not legal or safeguarding advice. You decide whether to send it.'
 };
}

export const HANDOVER_PREP = Object.freeze([
 {id:'details',title:'Confirm the practical details',description:'Time, place and any agreed arrangements'},
 {id:'essentials',title:'Pack what is needed',description:'Belongings, medication or school items where relevant'},
 {id:'child',title:'Think of one reassuring thing',description:'A familiar routine or calm goodbye, when contact is happening'},
 {id:'after',title:'Plan something kind for afterwards',description:'A walk, meal, a call or simply time to decompress'},
]);

export const WHEN_CONTACT_IS_LIMITED = Object.freeze([
 {id:'not-assume',title:'If there is no handover',description:'You can use the quiet reflections without assuming contact is happening'},
 {id:'self-care',title:'One thing in your control',description:'Choose a small action today that supports your wellbeing'},
 {id:'grief',title:'Name what feels hardest',description:'Privately recognise what you miss without needing to fix it'},
]);
