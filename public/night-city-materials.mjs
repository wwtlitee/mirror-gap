import {naturalMaterial} from './natural-materials.mjs';
// Adapted from GameHub authored city materials for modern Three.js; original metre coordinates retained.
/* Architectural surfaces use real metre repeats and separate window illumination. */





  export function createCityMaterials(T) {
    let seed = 711;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);

    function texture(width, height, paint) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      paint(canvas.getContext('2d'), width, height);
      const result = new T.CanvasTexture(canvas);
      result.colorSpace = T.SRGBColorSpace;
      result.wrapS = result.wrapT = T.RepeatWrapping;
      result.anisotropy = 4;
      return result;
    }

    function linearColor(color) {
      return color?.isColor ? color.clone() : new T.Color(color);
    }

    function standard(color, extra = {}) {
      const options = { roughness: 0.79, metalness: 0.08, ...extra, color: linearColor(extra.color ?? color) };
      if (extra.emissive !== undefined) options.emissive = linearColor(extra.emissive);
      return new T.MeshStandardMaterial(options);
    }

    function neon(color) {
      return new T.MeshBasicMaterial({ color: linearColor(color), toneMapped: false });
    }

    function rectangle(context, color, x, y, width, height) {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    }

    function grain(context, width, height, count, opacity) {
      for (let i = 0; i < count; i++) {
        const value = Math.floor(80 + random() * 80);
        rectangle(context, `rgba(${value},${value},${value},${opacity})`, random() * width, random() * height, 1 + random() * 3, 1);
      }
    }

    // The horizontal tangent keeps metre-wide bays on rotated walls. Ordinary
    // meshes never reference the instancing-only attribute.
    function worldSurface(material, width, height, key, floor = false) {
      material.userData.cityRepeatMeters = [width, height];
      material.onBeforeCompile = shader => {
        shader.vertexShader = 'varying vec3 cityPosition;\nvarying vec3 cityNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec4 cityLocalPosition = vec4(transformed, 1.0);
          vec3 cityLocalNormal = normal;
          #ifdef USE_INSTANCING
            cityLocalPosition = instanceMatrix * cityLocalPosition;
            cityLocalNormal = mat3(instanceMatrix) * cityLocalNormal;
          #endif
          cityPosition = cityLocalPosition.xyz;
          cityNormal = normalize(cityLocalNormal);
        `);
        shader.fragmentShader = 'varying vec3 cityPosition;\nvarying vec3 cityNormal;\n' + shader.fragmentShader;
        const projection = floor ? 'cityPosition.xz' : `
          (abs(cityNormal.y) > 0.8 ? cityPosition.xz :
            vec2(dot(cityPosition.xz, normalize(vec2(cityNormal.z, -cityNormal.x))), cityPosition.y))
        `;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          vec2 cityUV = ${projection} / vec2(${width.toFixed(2)}, ${height.toFixed(2)});
          diffuseColor *= texture2D(map, cityUV);
        `);
        if (material.emissiveMap) {
          shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
            totalEmissiveRadiance *= texture2D(emissiveMap, cityUV).rgb;
          `);
        }
      };
      material.customProgramCacheKey = () => `city-surface-v2-${key}-${width}-${height}`;
      return material;
    }

    const concreteMap = texture(256, 256, (context, width, height) => {
      rectangle(context, '#737b7c', 0, 0, width, height);
      grain(context, width, height, 9000, 0.14);
      rectangle(context, '#475557', 0, 0, 2, height);
      rectangle(context, '#526061', 0, 0, width, 2);
      for (let y = 20; y < height; y += 64) {
        for (let x = 20; x < width; x += 106) rectangle(context, '#4c595b', x, y, 2, 2);
      }
    });
    const asphaltMap = texture(256, 256, (context, width, height) => {
      rectangle(context, '#333b41', 0, 0, width, height);
      grain(context, width, height, 16000, 0.17);
      rectangle(context, 'rgba(9,15,19,0.18)', 107, 0, 26, height);
    });

    function facadePair(index) {
      const residential=index===1||index===3;
      const diffuse=document.createElement('canvas'),emission=document.createElement('canvas');
      diffuse.width=diffuse.height=emission.width=emission.height=1024;
      const face=diffuse.getContext('2d'),light=emission.getContext('2d');
      rectangle(face,residential?'#66645f':'#34434b',0,0,1024,1024);
      rectangle(light,'#000000',0,0,1024,1024);
      const polygon=(c,color,points)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const x=col*256+13,y=row*256+16,w=230,h=residential?196:211;
        const occupied=random()>(index===4?.15:residential?.35:.52),variant=Math.floor(random()*4);
        const room=document.createElement('canvas');room.width=230;room.height=211;const c=room.getContext('2d');
        const warm=residential||index===4;
        rectangle(c,occupied?(warm?'#aa9477':'#a3aba9'):'#27343a',0,0,w,h);
        polygon(c,occupied?(warm?'#e2cdae':'#d5d9d4'):'#293740',[[0,0],[w,0],[w-34,30],[34,30]]);
        polygon(c,occupied?(warm?'#736654':'#727e7e'):'#1a252d',[[0,h],[w,h],[w-34,h-42],[34,h-42]]);
        polygon(c,occupied?(warm?'#897965':'#8c999b'):'#223139',[[0,0],[34,30],[34,h-42],[0,h]]);
        polygon(c,occupied?(warm?'#baa589':'#acb7b7'):'#26353d',[[w,0],[w-34,30],[w-34,h-42],[w,h]]);
        rectangle(c,occupied?(warm?'#c5ad8c':'#aab8b6'):'#24333a',34,30,w-68,h-72);
        if(index===4){
          rectangle(c,'#665f55',36,h-67,158,7);rectangle(c,'#a9997c',41,h-98,146,3);
          for(const dx of [58,107,156]){rectangle(c,'#a89a80',dx,h-60,30,21);rectangle(c,occupied?'#e3d6bd':'#6a665a',dx+8,h-88,14,28);rectangle(c,'#665e53',dx+12,h-103,6,15);}
          rectangle(c,'#766d5d',36,68,158,5);rectangle(c,'#aaa18d',36,54,158,2);
          for(const dx of [40,87,134,185])rectangle(c,'#857d6d',dx,54,2,17);
          rectangle(c,occupied?'#efdec0':'#5a625e',53,17,125,4);
        }else if(residential){
          rectangle(c,'#655e57',65,h-79,109,33);rectangle(c,'#817463',59,h-67,121,27);
          rectangle(c,'#ad9678',70,h-76,30,16);rectangle(c,'#b5a18a',130,h-76,30,16);
          rectangle(c,'#4c4b46',92,h-32,53,5);rectangle(c,'#4b4a44',101,h-28,3,14);
          rectangle(c,'#615d52',44,h-99,3,61);polygon(c,occupied?'#f1d7a1':'#776d56',[[34,h-99],[57,h-99],[52,h-118],[39,h-118]]);
          if(variant!==0){const curtain=variant===1?50:24;rectangle(c,occupied?'#9a8c79':'#323b3b',0,0,curtain,h);rectangle(c,occupied?'#b9a892':'#38413e',w-curtain,0,curtain,h);for(let i=6;i<curtain;i+=9){rectangle(c,'rgba(20,24,23,.18)',i,0,3,h);rectangle(c,'rgba(20,24,23,.18)',w-i,0,3,h);}}
        }else{
          for(const dx of [50,121]){rectangle(c,'#5d6868',dx,h-68,61,7);rectangle(c,'#4d585a',dx+4,h-61,3,29);rectangle(c,'#4d585a',dx+52,h-61,3,29);rectangle(c,'#17282f',dx+17,h-96,31,23);rectangle(c,occupied?'#8daeb2':'#283940',dx+20,h-93,25,17);rectangle(c,'#344148',dx+24,h-60,23,24);}
          rectangle(c,occupied?'#eeeee0':'#526268',49,14,131,4);
          rectangle(c,'rgba(40,59,61,.40)',114,31,3,h-72);
          if(variant===1){for(let j=0;j<7;j++)rectangle(c,'rgba(89,105,105,.45)',32,42+j*15,166,3);}
        }
        if(variant===2){rectangle(c,'#57594c',185,h-56,12,16);polygon(c,'#536657',[[191,h-56],[176,h-77],[188,h-72],[194,h-94],[198,h-67],[208,h-79],[200,h-54]]);}
        face.drawImage(room,x,y,w,h);
        if(occupied){light.drawImage(room,x,y,w,h);}
        // Frames remain dark; interior walls and furniture carry the light.
        for(const c of [face,light]){rectangle(c,'#182930',x+w/2-2,y,4,h);rectangle(c,'#14252c',x,y+h-5,w,5);}
        rectangle(face,'rgba(160,191,203,.12)',x+3,y+3,13,h-8);
      }
      const maps=[diffuse,emission].map(canvas=>{const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;return map;});
      return {map:maps[0],emissiveMap:maps[1]};
    }

    const facadeNames = ['curtain-wall', 'concrete-slab', 'glass-fins', 'old-apartments', 'corporate-ribs', 'service-block'];
    const facade = facadeNames.map((name, index) => {
      const surface = standard(0xc7ced1, {
        ...facadePair(index),
        metalness: [0.48, 0.06, 0.62, 0.05, 0.25, 0.11][index],
        roughness: [0.35, 0.85, 0.24, 0.88, 0.53, 0.78][index],
        emissive: 0xffffff,
        emissiveIntensity: [0.12, 0.16, 0.12, 0.17, 0.15, 0.08][index]
      });
      surface.name = `city-${name}`;
      return worldSurface(surface, [28, 24, 28, 24, 56, 24][index], [20, 16, 20, 16, 40, 18][index], name);
    });

    function interior(warm) {
      function paintInterior(context, width, height, emission) {
        const background = context.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, emission ? '#000000' : warm ? '#27252a' : '#12282f');
        background.addColorStop(.55, emission ? '#010304' : warm ? '#171d23' : '#0c1722');
        background.addColorStop(1, emission ? '#000000' : warm ? '#303332' : '#213b42');
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        const accent = warm ? '#d5bb92' : '#e0d6bf';
        const secondary = warm ? '#a3937a' : '#a9b2ad';
        // Receding ceiling strips and an open mezzanine give the large panes depth.
        context.lineWidth = 3;
        context.strokeStyle = accent;
        for (const x of [60, 290, 740, 965]) {
          context.beginPath();
          context.moveTo(x, 25);
          context.lineTo(512 + (x - 512) * .48, 176);
          context.stroke();
        }
        rectangle(context, emission ? '#080b0d' : '#080f18', 190, 180, 644, 172);
        rectangle(context, accent, 210, 185, 600, 5);
        rectangle(context, emission ? '#172024' : '#293a42', 248, 230, 520, 13);
        rectangle(context, accent, 248, 230, 520, 2);
        rectangle(context, emission ? '#070c0d' : '#36494e', 248, 202, 520, 27);
        for (const x of [286, 505, 724]) rectangle(context, emission ? '#000000' : '#53646a', x, 198, 3, 43);
        // Tall backlit directory and broad display plinths; there are no shelf grids.
        rectangle(context, emission ? accent : '#467679', 665, 262, 65, 111);
        rectangle(context, emission ? '#16181a' : '#203238', 672, 270, 51, 94);
        rectangle(context, secondary, 679, 284, 35, 4);
        rectangle(context, secondary, 679, 301, 35, 3);
        rectangle(context, accent, 679, 340, 35, 3);
        rectangle(context, emission ? '#010204' : '#34464b', 285, 330, 166, 35);
        rectangle(context, accent, 285, 330, 166, 3);
        rectangle(context, emission ? '#030406' : '#4d5660', 523, 335, 87, 27);
        // Pools on the interior floor are softer and dimmer than the ceiling lights.
        const pool = context.createLinearGradient(0, 350, 0, 500);
        pool.addColorStop(0, warm ? 'rgba(209,151,84,.24)' : 'rgba(212,195,155,.18)');
        pool.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = pool;
        context.fillRect(210, 350, 600, 150);
        if (!emission) {
          rectangle(context, 'rgba(122,174,184,.09)', 0, 0, 120, height);
          rectangle(context, 'rgba(150,185,192,.05)', 750, 0, 90, height);
        }
      }
      const map = texture(1024, 512, (context, width, height) => paintInterior(context, width, height, false));
      const emissiveMap = texture(1024, 512, (context, width, height) => paintInterior(context, width, height, true));
      return worldSurface(standard(0xd4dce0, {
        map, emissiveMap, emissive: 0xffffff, emissiveIntensity: warm ? .7 : .9,
        metalness: .12, roughness: .68
      }), 32, 16, warm ? 'warm-lobby' : 'cool-retail');
    }
    const lobbyGlass = interior(true);
    const retailGlass = interior(false);

    return {
      roomGlazing:new T.MeshStandardMaterial({color:0x879da6,transparent:true,opacity:.13,depthWrite:false,metalness:.3,roughness:.22}),
      roomWarm:standard(0xbba585,{emissive:0xbba585,emissiveIntensity:.32,roughness:.9}),
      roomOffice:standard(0xb5beb9,{emissive:0xb5beb9,emissiveIntensity:.28,roughness:.9}),
      roomDark:standard(0x29363c,{roughness:.9}),
      roomFloor:standard(0x756d5d,{roughness:.85}),
      roomFurniture:standard(0x4f5960,{roughness:.95}),
      roomCurtain:standard(0xb1a58f,{roughness:1}),
      roomLamp:neon(0xf1dcc0),roomScreen:neon(0x859eac),
      standard,
      texture,
      facade,
      facadeNames,
      concrete: worldSurface(standard(0x919b9b, { map: concreteMap, roughness: .91 }), 8, 8, 'concrete'),
      stone: worldSurface(standard(0x626f76, { map: concreteMap }), 8, 8, 'stone'),
      metal: standard(0x29383f, { metalness: 0.52, roughness: 0.55 }),
      glass: standard(0x22434c, { metalness: 0.76, roughness: 0.2 }),
      asphalt: worldSurface(standard(0x253039, { map: asphaltMap, roughness: 0.48, metalness: .12 }), 8, 8, 'asphalt', true),
      rubber: standard(0x11191c),
      paint: standard(0x929788),
      yellow: standard(0xb7a05d),
      copper: standard(0x786050, { metalness: 0.42 }),
      plum: standard(0x4c3648, { roughness: 0.72 }),
      bronze: standard(0x6b5140, { metalness: 0.45 }),
      bark: naturalMaterial('bark',{color:0x6b5140,roughness:.94,metalness:0}),
      foliage: naturalMaterial('leaf',{color:0x4c3648,roughness:.85,metalness:0,vertexColors:true}),
      charcoal: standard(0x23323a),
      pale: standard(0x85999f, { roughness: 0.84 }),
      lobbyGlass,
      retailGlass,
      shopGlass: retailGlass,
      warm: neon(0xffb979),
      violet: neon(0xaa83ff),
      lime: neon(0x9bff78),
      cyan: neon(0x49d2e4),
      red: neon(0xee526b),
      pink: neon(0xf17eb9),
      teal: neon(0x58c5b9),
      white: neon(0xd4e5e7)
    };
  }

