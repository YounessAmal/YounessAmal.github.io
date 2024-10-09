import * as kokomi from "https://esm.sh/kokomi.js";
import * as THREE from "https://esm.sh/three";
import gsap from "https://esm.sh/gsap";

const vertexShader = /* glsl */ `
uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

varying vec2 vUv;

uniform vec2 uMeshSize;
uniform vec2 uMediaSize;
uniform vec2 uOffset;
uniform float uOpacity;
uniform float uMouseEnter;
uniform float uMouseEnterMask;

varying vec2 vDummy;

const float PI=3.14159265359;

vec2 scale(in vec2 st,in vec2 s,in vec2 center){
    return(st-center)*s+center;
}

float saturate(float a){
    return clamp(a,0.,1.);
}

// https://tympanus.net/codrops/2019/10/21/how-to-create-motion-hover-effects-with-image-distortions-using-three-js/
vec3 deformationCurve(vec3 position,vec2 uv,vec2 offset){
    position.x=position.x+(sin(uv.y*PI)*offset.x);
    position.y=position.y+(sin(uv.x*PI)*offset.y);
    return position;
}

vec2 getUVScale(){
    // return vec2(.63);
    float d=length(uMeshSize);
    float longEdge=max(uMeshSize.x,uMeshSize.y);
    float dRatio=d/longEdge;
    float mRatio=uMeshSize.x/uMeshSize.y;
    return vec2(mRatio/dRatio);
}

// https://github.com/Anemolo/GridToFullscreenAnimations/blob/master/js/GridToFullscreenEffect.js
float getProgress(float activation,float latestStart,float progress,float progressLimit){
    float startAt=activation*latestStart;
    float pr=smoothstep(startAt,1.,progress);
    float p=min(saturate(pr/progressLimit),saturate((1.-pr)/(1.-progressLimit)));
    return p;
}

vec3 distort(vec3 p){
    vec2 uvDistortion=uv;
    vec2 uvScale=getUVScale();
    uvDistortion=scale(uvDistortion,uvScale,vec2(.5));
    uvDistortion=(uvDistortion-.5)*2.;
    // vDummy=uvDistortion;
    float d=length(uvDistortion);
    float pr=getProgress(d,.8,uMouseEnter,.75)*.08;
    // vDummy=vec2(pr*3.);
    p.xy*=(1.+pr);
    return p;
}

void main(){
    vec3 p=position;
    p=deformationCurve(p,uv,uOffset);
    p=distort(p);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
    
    vUv=uv;
}
`;

const fragmentShader = /* glsl */ `
uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

varying vec2 vUv;

uniform sampler2D iChannel0;

uniform vec2 uMeshSize;
uniform vec2 uMediaSize;
uniform vec2 uOffset;
uniform float uOpacity;
uniform float uMouseEnter;
uniform float uMouseEnterMask;

varying vec2 vDummy;

// https://gist.github.com/statico/df64c5d167362ecf7b34fca0b1459a44
vec2 cover(vec2 s,vec2 i,vec2 uv){
    float rs=s.x/s.y;
    float ri=i.x/i.y;
    vec2 new=rs<ri?vec2(i.x*s.y/i.y,s.y):vec2(s.x,i.y*s.x/i.x);
    vec2 offset=(rs<ri?vec2((new.x-s.x)/2.,0.):vec2(0.,(new.y-s.y)/2.))/new;
    uv=uv*s/new+offset;
    return uv;
}

vec2 scale(in vec2 st,in vec2 s,in vec2 center){
    return(st-center)*s+center;
}

vec2 ratio2(in vec2 v,in vec2 s){
    return mix(vec2(v.x,v.y*(s.y/s.x)),
    vec2((v.x*s.x/s.y),v.y),
    step(s.x,s.y));
}

vec2 distort(vec2 uv){
    uv-=.5;
    
    float mRatio=uMeshSize.x/uMeshSize.y;
    
    // key lines
    float pUvX=pow(uv.x*mRatio,2.);
    float pUvY=pow(uv.y,2.);
    float pSum=pUvX+pUvY;
    float multiplier=10.*(1.-uMouseEnter);
    float strength=1.-multiplier*pSum;
    uv*=strength;
    
    uv+=.5;
    return uv;
}

float getMaskDist(vec2 uv){
    uv=uv*2.-1.;
    uv=ratio2(uv,uMeshSize);
    float d=length(uv);
    float aspectXY=uMeshSize.x/uMeshSize.y;
    float aspectYX=uMeshSize.y/uMeshSize.x;
    float aspect=min(aspectXY,aspectYX);
    d/=sqrt(1.+pow(aspect,2.));
    return d;
}

void main(){
    vec2 uv=vUv;
    uv=cover(uMeshSize,uMediaSize.xy,uv);
    
    float d=getMaskDist(uv);
    float mask=1.-step(uMouseEnterMask,d);
    
    uv=scale(uv,vec2(1./(1.+(1.-uMouseEnter)*.25)),vec2(.5));
    
    uv=distort(uv);
    
    vec4 tex=texture(iChannel0,uv);
    vec3 color=tex.rgb;
    // mask=1.;
    float alpha=mask*uOpacity;
    // color=vec3(vec2(vDummy),0.);
    gl_FragColor=vec4(color,alpha);
}
`;

class Sketch extends kokomi.Base {
  async create() {
    const config = {
      offsetAmount: 1
    };

    const galleryEl = document.querySelector(".gallery");
    const galleryItems = [...document.querySelectorAll(".gallery-item")];
    const hoverImg = document.querySelector(".hover-img");
    const resourceList = galleryItems.map((item, i) => ({
      name: item.dataset["glImgName"],
      type: "texture",
      path: item.dataset["glImg"]
    }));
    const am = new kokomi.AssetManager(this, resourceList);

    am.on("ready", async () => {
      document.querySelector(".loader-screen")?.classList.add("hollow");

      const screenCamera = new kokomi.ScreenCamera(this);
      screenCamera.addExisting();

      const geometry = new THREE.PlaneGeometry(1, 1, 64, 64);
      const uj = new kokomi.UniformInjector(this);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        uniforms: {
          ...uj.shadertoyUniforms,
          iChannel0: {
            value: null
          },
          uMeshSize: {
            value: new THREE.Vector2(0, 0)
          },
          uMediaSize: {
            value: new THREE.Vector2(0, 0)
          },
          uOffset: {
            value: new THREE.Vector2(0, 0)
          },
          uOpacity: {
            value: 0
          },
          uMouseEnter: {
            value: 0
          },
          uMouseEnterMask: {
            value: 0
          }
        }
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(hoverImg.clientWidth, hoverImg.clientHeight, 1);
      this.scene.add(mesh);

      let targetX = 0;
      let targetY = 0;

      let offsetX = 0;
      let offsetY = 0;

      this.update(() => {
        uj.injectShadertoyUniforms(material.uniforms);

        targetX = this.interactionManager.mouse.x;
        targetY = this.interactionManager.mouse.y;

        offsetX = THREE.MathUtils.lerp(offsetX, targetX, 0.1);
        offsetY = THREE.MathUtils.lerp(offsetY, targetY, 0.1);

        material.uniforms.uOffset.value = new THREE.Vector2(
          (targetX - offsetX) * config.offsetAmount,
          (targetY - offsetY) * config.offsetAmount
        );

        gsap.to(mesh.position, {
          x: (this.interactionManager.mouse.x * window.innerWidth) / 2,
          y: (this.interactionManager.mouse.y * window.innerHeight) / 2
        });

        gsap.to(hoverImg, {
          x: this.iMouse.mouseDOM.x - hoverImg.clientWidth / 2,
          y: this.iMouse.mouseDOM.y - hoverImg.clientHeight / 2
        });
      });

      const doTransition = (item) => {
        if (item) {
          hoverImg.src = item.dataset["glImg"];
          const tex = am.items[item.dataset["glImgName"]];
          material.uniforms.iChannel0.value = tex;
          material.uniforms.uMeshSize.value = new THREE.Vector2(
            mesh.scale.x,
            mesh.scale.y
          );
          material.uniforms.uMediaSize.value = new THREE.Vector2(
            tex.image.width,
            tex.image.height
          );
          gsap.to(material.uniforms.uOpacity, {
            value: 1,
            duration: 0.3
          });
          gsap.fromTo(
            material.uniforms.uMouseEnter,
            {
              value: 0
            },
            {
              value: 1,
              duration: 1.2,
              ease: "power2.out"
            }
          );
          gsap.fromTo(
            material.uniforms.uMouseEnterMask,
            {
              value: 0
            },
            {
              value: 1,
              duration: 0.7,
              ease: "power2.out"
            }
          );
        } else {
          gsap.to(material.uniforms.uOpacity, {
            value: 0,
            duration: 0.3
          });
        }
      };

      let currentItem = null;

      galleryItems.forEach((item) => {
        item.addEventListener("mouseenter", () => {
          currentItem = item;
          doTransition(currentItem);
        });
      });
      galleryEl.addEventListener("mouseleave", () => {
        currentItem = null;
        doTransition(currentItem);
      });
    });
  }
}

const sketch = new Sketch("#sketch");
sketch.create();