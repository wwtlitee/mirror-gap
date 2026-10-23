import {CanvasTexture,RGBAFormat,UnsignedByteType,TextureSource} from 'three';

const ownedResources=new WeakMap();
const dataMapProperties=['metalnessMap','roughnessMap','bumpMap'];
function defaultCanvas(){return document.createElement('canvas');}
function disposeResources(resources){
  resources.materials.forEach(material=>material.dispose());
  resources.textures.forEach(texture=>texture.dispose());
}

// Clones share geometry and ordinary textures. Only converted export textures
// and material copies are owned here; never dispose a live model's resources.
export function createCharacterExportClone(root,{createCanvas=defaultCanvas}={}){
  if(!root?.isObject3D||typeof root.clone!=='function')throw new TypeError('Invalid character root');
  const model=root.clone(true),copies=new Map(),textures=new Map();
  function exportTexture(source){
    if(!source?.isDataTexture)return source;
    if(textures.has(source))return textures.get(source);
    const {data,width,height}=source.image??{};
    if(source.format!==RGBAFormat||source.type!==UnsignedByteType||!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!ArrayBuffer.isView(data)||data.length!==width*height*4)throw new TypeError('Unsupported character data texture');
    const canvas=createCanvas();canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Cannot create character export texture');
    const pixels=context.createImageData(width,height);pixels.data.set(data);context.putImageData(pixels,0,0);
    const texture=new CanvasTexture(canvas);
    // Copy sampling, UV transform and color space with a fresh image source.
    // Texture.copy marks that source dirty; never temporarily share the live one.
    texture.copy({...source,source:new TextureSource(canvas)});
    textures.set(source,texture);return texture;
  }
  function exportMaterial(material){
    if(!dataMapProperties.some(property=>material[property]?.isDataTexture))return material;
    if(!copies.has(material)){
      const copy=material.clone();copies.set(material,copy);
      for(const property of dataMapProperties)if(copy[property])copy[property]=exportTexture(copy[property]);
    }
    return copies.get(material);
  }
  try{
    model.traverse(object=>{
      if(object!==model&&object.isGroup&&['near','mid'].includes(object.userData.detailLevel))object.visible=true;
      if(object.material)object.material=Array.isArray(object.material)?object.material.map(exportMaterial):exportMaterial(object.material);
    });
  }catch(error){disposeResources({materials:new Set(copies.values()),textures:new Set(textures.values())});throw error;}
  ownedResources.set(model,{materials:new Set(copies.values()),textures:new Set(textures.values())});
  return model;
}

export function disposeCharacterExportClone(model){
  const resources=ownedResources.get(model);if(!resources)return;
  ownedResources.delete(model);disposeResources(resources);
}
