// Brief neural/contact gaps do not turn an unfinished meal into a new meal.
// Progress still requires real mouth contact and real neural feeding output.
export function activeResourceSession(s,kind,id=null){
 const session=s.living.resourceSession;
 return Boolean(session&&session.kind===kind&&(!id||session.id===id)&&s.simSeconds-session.lastProgressAt<=2);
}
export function updateResourceSession(s){
 const resource=s.actor.consumingResource;
 if(resource&&['eat','drink'].includes(s.living.behavior)){
  s.living.resourceSession={id:resource.id,kind:resource.kind,lastProgressAt:s.simSeconds};
 }else if(s.living.resourceSession&&s.simSeconds-s.living.resourceSession.lastProgressAt>2){
  s.living.resourceSession=null;
 }
}
export function validateResourceSession(session){
 if(session==null)return;
 if(typeof session.id!=='string'||!['food','water'].includes(session.kind)||!Number.isFinite(session.lastProgressAt)||session.lastProgressAt<0)throw Error('Invalid resource session');
}
