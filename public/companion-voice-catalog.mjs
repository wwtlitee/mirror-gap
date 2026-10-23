import {PERSONA_LINES} from './companion-personas.mjs';
export const VOICE_BANKS=[
  {
    "id": "mambo",
    "name": "曼波",
    "en": "Mambo",
    "referenceId": "b255ca2902514f69bc22243436a94e4f",
    "persona": "软萌乐天，短句叠词",
    "personaEn": "Cheerful and cuddly",
    "gap": 35,
    "curiosity": 0.55,
    "caution": 0.35,
    "sociability": 0.65
  },
  {
    "id": "announcer",
    "name": "小小播报员",
    "en": "Little announcer",
    "referenceId": "59cb5986671546eaa6ca8ae6f29f6d22",
    "persona": "认真播报，生活也有仪式感",
    "personaEn": "A diligent little reporter",
    "gap": 45,
    "curiosity": 0.45,
    "caution": 0.6,
    "sociability": 0.5
  },
  {
    "id": "hype",
    "name": "戏很多",
    "en": "Hype buddy",
    "referenceId": "3b0564702a264ce58f6d13e0b8f2bd74",
    "persona": "热情夸张，爱分享小事",
    "personaEn": "An enthusiastic storyteller",
    "gap": 65,
    "curiosity": 0.65,
    "caution": 0.35,
    "sociability": 0.7
  },
  {
    "id": "theatre",
    "name": "小剧场",
    "en": "Drama club",
    "referenceId": "79b434bcd1fb407388f55bd52819814f",
    "persona": "戏剧腔调，自有小小气场",
    "personaEn": "A theatrical little presence",
    "gap": 60,
    "curiosity": 0.5,
    "caution": 0.5,
    "sociability": 0.5
  },
  {
    "id": "soft",
    "name": "轻声细语",
    "en": "Soft spoken",
    "referenceId": "faccba1a8ac54016bcfc02761285e67f",
    "persona": "温和慢热，安静地陪伴",
    "personaEn": "Gentle and unhurried",
    "gap": 45,
    "curiosity": 0.35,
    "caution": 0.65,
    "sociability": 0.4
  },
  {
    "id": "bright",
    "name": "元气邻居",
    "en": "Sunny neighbour",
    "referenceId": "fbe02f8306fc4d3d915e9871722a39d5",
    "persona": "开朗亲切，喜欢一起发现",
    "personaEn": "A friendly optimist",
    "gap": 40,
    "curiosity": 0.65,
    "caution": 0.4,
    "sociability": 0.65
  },
  {
    "id": "commander",
    "name": "李云龙",
    "en": "Li Yunlong",
    "referenceId": "2e576989a8f94e888bf218de90f8c19a",
    "persona": "豪爽直率，嘴硬但热心",
    "personaEn": "Blunt, hearty and warm",
    "gap": 65,
    "curiosity": 0.6,
    "caution": 0.35,
    "sociability": 0.6
  },
  {
    "id": "strategist",
    "name": "诸葛",
    "en": "Zhuge",
    "referenceId": "e30bbef197c84eabbced4fb19c8aa103",
    "persona": "从容周到，说话不急不躁",
    "personaEn": "Calm and considered",
    "gap": 65,
    "curiosity": 0.55,
    "caution": 0.7,
    "sociability": 0.4
  },
  {
    "id": "guardian",
    "name": "关羽",
    "en": "Guan Yu",
    "referenceId": "9d4e156e552341babd8fa618e8290c10",
    "persona": "沉稳寡言，惜字如金",
    "personaEn": "Steady and sparing with words",
    "gap": 85,
    "curiosity": 0.4,
    "caution": 0.65,
    "sociability": 0.3
  },
  {
    "id": "monkey",
    "name": "孙悟空",
    "en": "Monkey King",
    "referenceId": "5849b84966954a27a0e91718efd734af",
    "persona": "机灵好动，喜欢四处看看",
    "personaEn": "Playful and adventurous",
    "gap": 55,
    "curiosity": 0.7,
    "caution": 0.3,
    "sociability": 0.6
  },
  {
    "id": "passionate",
    "name": "刘备（愤怒）",
    "en": "Passionate Liu Bei",
    "referenceId": "8a9310ea9df5407882793705db93bbe7",
    "persona": "情绪鲜明，认真又急性子",
    "personaEn": "Expressive and earnest",
    "gap": 80,
    "curiosity": 0.55,
    "caution": 0.4,
    "sociability": 0.6
  },
  {
    "id": "chronicler",
    "name": "新三国旁白",
    "en": "Three Kingdoms narrator",
    "referenceId": "aee82fa1dd7546588690fb1917abfb47",
    "persona": "旁白视角，把日常说成故事",
    "personaEn": "Daily life as a little chronicle",
    "gap": 75,
    "curiosity": 0.5,
    "caution": 0.6,
    "sociability": 0.35
  },
  {
    "id": "villain",
    "name": "反派1",
    "en": "Little villain",
    "referenceId": "686549c77f85483bb2aa14938c6e1d43",
    "persona": "故作高冷，其实爱舒服",
    "personaEn": "A lofty pose with a soft side",
    "gap": 65,
    "curiosity": 0.45,
    "caution": 0.55,
    "sociability": 0.3
  },
  {
    "id": "youngster",
    "name": "正太2",
    "en": "Young companion",
    "referenceId": "52841ac9a207490290db8f5b24f9b226",
    "persona": "清爽坦率，带一点腼腆",
    "personaEn": "Bright and a little shy",
    "gap": 45,
    "curiosity": 0.6,
    "caution": 0.55,
    "sociability": 0.5
  },
  {
    "id": "curious",
    "name": "安妮亚",
    "en": "Anya",
    "referenceId": "5ae25bb863d548879af70c0d0667f070",
    "persona": "天真好奇，把小事当发现",
    "personaEn": "Curious about little discoveries",
    "gap": 45,
    "curiosity": 0.7,
    "caution": 0.45,
    "sociability": 0.6
  },
  {
    "id": "trickster",
    "name": "功夫·周星驰",
    "en": "Kung Fu comic",
    "referenceId": "753b8a9bf6e54bee8d9f516ca5092f91",
    "persona": "轻松自嘲，日常里找笑点",
    "personaEn": "Wry, playful everyday humour",
    "gap": 60,
    "curiosity": 0.6,
    "caution": 0.4,
    "sociability": 0.65
  },
  {
    "id": "detective",
    "name": "柯南",
    "en": "Conan",
    "referenceId": "2be01e35836944349cb569863173e6c9",
    "persona": "细心观察，喜欢确认细节",
    "personaEn": "Observant and detail-minded",
    "gap": 55,
    "curiosity": 0.7,
    "caution": 0.65,
    "sociability": 0.4
  },
  {
    "id": "bunny",
    "name": "兔娘",
    "en": "Bunny neighbour",
    "referenceId": "f7ab4c68e0d94d88bf44ab18c854f0d2",
    "persona": "柔软亲近，温暖的小邻居",
    "personaEn": "A soft and friendly neighbour",
    "gap": 45,
    "curiosity": 0.45,
    "caution": 0.55,
    "sociability": 0.7
  },
  {
    "id": "mischief",
    "name": "蜡笔小新",
    "en": "Shin-chan",
    "referenceId": "0eb02e48c5d5475188158be2e214d67b",
    "persona": "顽皮逗趣，有自己的小主意",
    "personaEn": "Mischievous with little ideas",
    "gap": 60,
    "curiosity": 0.65,
    "caution": 0.3,
    "sociability": 0.65
  }
];
export const VOICE_EVENTS=['welcome','fed','drink','rested','sleepy','play','escaped','clean','explore','familiar'];
export const VOICE_LINES=Object.fromEntries(VOICE_EVENTS.map((event,i)=>[event,PERSONA_LINES.mambo.slice(i*2,i*2+2).map(line=>line.split('|'))]));
export function voiceLine(bank,event,index){
  const position=VOICE_EVENTS.indexOf(event);
  if(position<0||![0,1].includes(index)||!VOICE_BANKS.some(v=>v.id===bank))throw Error('Unknown voice line');
  const entry=PERSONA_LINES[bank]?.[position*2+index];
  if(!entry)throw Error('Incomplete persona '+bank);
  const [text,english]=entry.split('|');
  return {text,english,url:`/assets/voices/${bank}/${event}-${index}.mp3`};
}
