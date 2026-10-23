// UTC+08:00 has no daylight-saving transitions. Independent of host timezone.
export function beijingHour(date=new Date()){const d=new Date(date.getTime()+8*3600000);return d.getUTCHours()+d.getUTCMinutes()/60+d.getUTCSeconds()/3600;}
export const beijingDate=(date=new Date())=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
