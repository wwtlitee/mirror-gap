import * as THREE from 'three';

const COLORS=Object.freeze({A:0x57c1ff,B:0xffc533});

export function cueMarkerDescriptors(state){
  if(!state?.experiment)return [];
  const cues=state.neural?.learning?.cues;
  if(!Array.isArray(cues))return [];
  return cues.filter(cue=>cue&&typeof cue.id==='string'&&cue.id.startsWith('cue-')
    &&Object.hasOwn(COLORS,cue.odor)&&cue.enabled===true&&Number.isFinite(cue.strength)&&cue.strength>0
    &&Array.isArray(cue.position)&&cue.position.length===3&&cue.position.every(Number.isFinite))
    .map(cue=>({id:cue.id,label:cue.odor,color:COLORS[cue.odor],position:[...cue.position]}));
}

/** Visual source labels only; never added to collision or navigation geometry. */
export function createCueTrainingMarkers(parent){
  const root=new THREE.Group();root.name='Training_cue_markers';parent.add(root);
  const markers=new Map(),geometry=new THREE.RingGeometry(.055,.07,48);
  const textures=new Set(),materials=new Set();let disposed=false;
  function make(descriptor){
    const group=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:descriptor.color,
      transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false});materials.add(material);
    const ring=new THREE.Mesh(geometry,material);ring.rotation.x=-Math.PI/2;group.add(ring);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=96;
    const context=canvas.getContext('2d');
    if(context){
      context.fillStyle='#202326';context.beginPath();context.arc(48,48,41,0,Math.PI*2);context.fill();
      context.strokeStyle='#'+descriptor.color.toString(16).padStart(6,'0');context.lineWidth=5;context.stroke();
      context.fillStyle='#ffffff';context.textAlign='center';context.textBaseline='middle';
      context.font='600 49px system-ui';context.fillText(descriptor.label,48,51);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.add(texture);
      const spriteMaterial=new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false});materials.add(spriteMaterial);
      const label=new THREE.Sprite(spriteMaterial);label.position.y=.24;label.scale.set(.38,.38,1);label.renderOrder=20;group.add(label);
    }
    root.add(group);return group;
  }
  function update(state){
    if(disposed)return;
    const descriptors=cueMarkerDescriptors(state),active=new Set(descriptors.map(cue=>cue.id+'|'+cue.label));
    for(const [id,group]of markers)group.visible=active.has(id);
    for(const cue of descriptors){
      const key=cue.id+'|'+cue.label;
      let group=markers.get(key);
      if(!group){group=make(cue);markers.set(key,group);}
      group.position.set(cue.position[0],cue.position[1]+.012,cue.position[2]);group.visible=true;
    }
  }
  function dispose(){
    if(disposed)return;disposed=true;root.removeFromParent();geometry.dispose();
    for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();markers.clear();
  }
  return {update,dispose,diagnostics:()=>({count:[...markers.values()].filter(group=>group.visible).length})};
}
