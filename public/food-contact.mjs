// Compatibility API; food and water share the affordance index.
import {nearestResource,resourceWithinReach,resourceContact} from './resource-contact.mjs';
export {MOUTH_REACH} from './resource-contact.mjs';
export const nearestFood=(position,options)=>nearestResource(position,'food',options);
export const foodWithinReach=actor=>resourceWithinReach(actor,'food');
export const foodContact=actor=>resourceContact(actor,'food');
