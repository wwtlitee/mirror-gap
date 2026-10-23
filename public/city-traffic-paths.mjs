const wrap=(value,length)=>((value%length)+length)%length;
export function trafficPaths(time){
 const t=Number.isFinite(time)?Math.max(0,time):0;
 const cars=Array.from({length:8},(_,i)=>{const lane=i%4,direction=lane<2?1:-1,x=[-23,-10,10,23][lane],phase=wrap(t*7+Math.floor(i/4)*270+lane*61,540);return {position:[x,1.82,direction>0?-340+phase:200-phase],heading:direction>0?0:Math.PI};});
 const hover=Array.from({length:2},(_,i)=>{const direction=i?1:-1;return {position:[i?16:-16,34+i*8+Math.sin(t*.35+i)*.12,-320+wrap(t*direction*5+i*230,560)],heading:direction>0?0:Math.PI};});
 const robots=Array.from({length:12},(_,i)=>{const phase=wrap(t*(.42+i%3*.06)+i*5,46),forward=phase<23;return {position:[i%2?33:-33,1.43,-250+Math.floor(i/2)*67+(forward?phase:46-phase)],heading:forward?0:Math.PI,phase:t*3.1+i};});
 return {cars,hover,robots};
}
