export const VERSION = '8.5.0';
export const ROOM = Object.freeze({ width: 12, depth: 9, height: 5, cruiseHeight: 3.4 });
export const ZONES = Object.freeze([
  { id: 'rest', name: '栖息舱', description: '收拢翅膀，把一整天慢慢放下。', position: [-4.3, 1.14, -2.45], action: 'rest', label: '正在休息' },
  { id: 'feed', name: '补给台', description: '水果、汉堡、披萨，各自放在干净的盘碟里。', position: [-2.62, 1.22, 1.60], action: 'eat', label: '正在进食' },
  { id: 'work', name: '探索工作台', description: '屏幕里的小世界，等他自己发现。', position: [-1.25, 1.51, -3.0], action: 'reflect', label: '正在探索屏幕' },
  { id: 'garden', name: '窗边观景台', description: '通透的落地玻璃与窄观景台，望向街道与远处灯火。', position: [3.1, 1.365, -3.88], action: 'observe', label: '正在看窗外' },
  { id: 'flight', name: '自由飞行区', description: '留一片空地，想飞的时候就起飞。', position: [0.25, 2.25, 0.75], action: 'explore', label: '正在自由探索' },
  { id: 'entry', name: '生态林地 · 湿地', description: '树根旁的浅水、卵石与苔藓，自由进出的自然角落。', position: [4.5, 0.36, 3.50], action: 'visit', label: '正在感受水汽' },
  { id: 'perch', name: '生态林地 · 树冠', description: '从苔藓和树根到高枝，穿行、落脚、探查。', position: [4.96, 2.03, -.1], action: 'observe', label: '正在高处停留' },
  { id: 'nook', decorative:true, name: '书柜 · 装饰', description: '光线温柔的藏身处，安静下来再探头。', position: [-4.93, 1.115, 2.1], action: 'rest', label: '经过书柜' },
  {id:'toilet',name:'迷你厕所',description:'吃饱后，也有一个安静解决身体需求的角落。',position:[4.35,.62,.38],action:'visit',label:'正在使用迷你厕所'}
]);
export const ZONE_BY_ID = Object.freeze(Object.fromEntries(ZONES.map(zone => [zone.id, zone])));
