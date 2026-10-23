import {appearanceFromSeed,hashSeed} from './companion-identity.mjs';

export const NATURAL_APPEARANCE_SCHEMA = 'drosophila-natural-v1';
const variation = (seed,key) => hashSeed(`${seed ?? 'default'}:${NATURAL_APPEARANCE_SCHEMA}:${key}`) / 0xffffffff;
const mix = (low,high,value) => low + (high-low)*value;

// Keyed fields cannot reshuffle another trait when a later detail is added.
// Identity, voice and the legacy appearance indexes remain owned by the save.
export function naturalAppearanceFromSeed(seed) {
  const shell=variation(seed,'cuticle'),eye=variation(seed,'eye'),band=variation(seed,'abdominal-band');
  return {
    schema:NATURAL_APPEARANCE_SCHEMA,
    shellHue:mix(.074,.102,shell),shellLight:mix(.35,.43,shell),shellSaturation:mix(.39,.48,shell),
    headLight:mix(.23,.29,variation(seed,'head')),eyeHue:mix(.005,.027,eye),eyeLight:mix(.23,.31,eye),
    eyeSaturation:mix(.70,.82,eye),abdomenLight:mix(.37,.45,variation(seed,'abdomen')),
    bandWidth:mix(.022,.038,band),bandLight:mix(.12,.19,variation(seed,'band-color')),
    wingHue:mix(.10,.13,variation(seed,'wing')),wingOpacity:mix(.17,.23,variation(seed,'membrane')),
    veinLight:mix(.27,.36,variation(seed,'vein')),antennaLength:mix(.97,1.03,variation(seed,'antenna')),
    bristleLength:mix(.91,1.08,variation(seed,'setae')),bristleDensity:variation(seed,'setae-density'),
    metallic:0,
  };
}

export function appearancePalette(seed) {
  // Keep the export shape used by older callers, while rendering the new palette.
  return {...appearanceFromSeed(seed ?? 'default'),...naturalAppearanceFromSeed(seed)};
}

export function appearanceLabels(seed,english=false) {
  const p=naturalAppearanceFromSeed(seed);
  return english
    ? ['Brick-red eyes',p.shellLight>.39?'Honey-brown cuticle':'Warm brown cuticle',p.bandWidth>.03?'Broad dark abdominal bands':'Fine dark abdominal bands','Clear, lightly tinted wings','Fine branched antennae',p.bristleDensity>.5?'Fine, fuller setae':'Fine, sparse setae']
    : ['砖红复眼',p.shellLight>.39?'蜜褐胸甲':'暖褐胸甲',p.bandWidth>.03?'宽深腹纹':'细深腹纹','淡色透明翅膜','细芒分枝触角',p.bristleDensity>.5?'细密自然刚毛':'稀疏自然刚毛'];
}
