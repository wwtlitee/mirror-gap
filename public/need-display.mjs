// Display scores only: raw physiology and saved neural inputs retain their units.
export const NEED_METERS = {
 energy:{label:'精力',hint:'飞行、行走会消耗；睡眠与安静休息恢复',source:'needs'},
 satiety:{label:'饱足度',hint:'活动与时间会消耗；进食后恢复',source:'needs'},
 curiosity:{label:'娱乐度',hint:'闲置时下降；探索、观景和游戏提升',source:'needs',inverse:true},
 comfort:{label:'舒适度',hint:'身体不适与惊扰会降低；清洁、观景和休息改善',source:'needs'},
 thirst:{label:'水分',hint:'时间与活动会消耗；实际饮水后补充',source:'physiology',inverse:true},
 sleepPressure:{label:'休息充足度',hint:'持续清醒会降低；安静睡眠后恢复',source:'physiology',inverse:true},
 dirt:{label:'洁净度',hint:'活动和进食会降低；水边清洁与梳理提升',source:'physiology',inverse:true},
 waste:{label:'排泄舒适度',hint:'消化与饮食使负担增加、分数降低；如厕后恢复',source:'physiology',inverse:true},
 alert:{label:'安心度',hint:'声音、阴影或持续受困会降低；脱困与安静后恢复',source:'living',inverse:true},
 wetness:{label:'干爽度',hint:'浅水和喷雾会降低；梳理与自然风干恢复',source:'living',inverse:true}
};
export function needScore(state,key){
 const meter=NEED_METERS[key];if(!meter)return null;
 const group=meter.source==='needs'?state?.needs:meter.source==='physiology'?state?.living?.physiology:state?.living;
 const raw=key==='alert'&&Number.isFinite(group?.alert)?Math.max(group.alert,state?.living?.escape?.stress??0):group?.[key];
 // Missing/invalid data must not look like a perfect physiological score.
 if(typeof raw!=='number'||!Number.isFinite(raw))return null;
 const percent=Math.max(0,Math.min(100,raw*(meter.source==='needs'?1:100)));
 return Math.round(meter.inverse?100-percent:percent);
}
