// The low-fi horror look, built the way PS1-style horror games do it:
//
//  1. Low internal resolution with hard pixels and no anti-aliasing (set up in game.js).
//  2. Vertex snapping: every corner of every shape is rounded to a coarse screen grid, so
//     geometry jitters and wobbles slightly as you move, like the original PlayStation.
//  3. Limited colour depth (like the PS1's 15-bit colour) with ordered "Bayer" dithering, the
//     checkered pattern that fakes in-between colours. It shows most in shadows and fog.
//  4. A grim colour grade, a vignette, film grain and a little lens fringing at the edges.
//
// The scene is drawn into an off-screen image first, then one full-screen pass applies 3 and 4.
import * as THREE from 'three';

// ---------- Settings ----------
export const LOFI = {
  exposure: 1.35,         // overall brightness before the look is applied
  lift: 0.022,            // raises the blacks to a murky grey-green instead of pure black
  colorLevels: 32,        // shades per colour channel (PS1 = 32). Lower = more banding + dithering
  ditherStrength: 1.0,    // 0 = none, 1 = full
  snapGrid: [192, 144],   // vertex wobble grid; lower = more wobble (0 turns it off)
  grain: 0.055,           // film grain amount
  vignette: 0.45,         // edge darkening
  fringe: 0.006,          // colour fringing toward the edges
  saturation: 0.78,       // 1 = normal colour, lower = more washed out
  tint: [0.94, 1.0, 0.93],// overall colour cast (slightly sickly green)
};

/**
 * Vertex snapping, patched into three.js's shared shader code so it applies to every
 * object automatically. Must run before anything is drawn for the first time.
 */
export function enableVertexSnapping() {
  const [gx, gy] = LOFI.snapGrid;
  if (!gx || !gy) return;
  THREE.ShaderChunk.project_vertex += `
    // PS1-style vertex snapping (not for shadow maps, which would get blocky)
    #if !defined( DEPTH_PACKING ) && !defined( DISTANCE )
      if ( gl_Position.w > 0.0 ) {
        vec2 snapGrid = vec2( ${gx.toFixed(1)}, ${gy.toFixed(1)} );
        gl_Position.xy = floor( gl_Position.xy / gl_Position.w * snapGrid + 0.5 ) / snapGrid * gl_Position.w;
      }
    #endif
  `;
}

/** Off-screen render + the full-screen look pass. Use instead of renderer.render. */
export function createLofiRenderer(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,              // keeps bright values, so tone mapping still works
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture },
      time: { value: 0 },
      exposure: { value: LOFI.exposure },
      lift: { value: LOFI.lift },
      levels: { value: LOFI.colorLevels },
      dither: { value: LOFI.ditherStrength },
      grain: { value: LOFI.grain },
      vignette: { value: LOFI.vignette },
      fringe: { value: LOFI.fringe },
      saturation: { value: LOFI.saturation },
      tint: { value: new THREE.Vector3(...LOFI.tint) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform float time, exposure, lift, levels, dither, grain, vignette, fringe, saturation;
      uniform vec3 tint;
      varying vec2 vUv;

      // 4x4 Bayer matrix: the classic ordered-dither pattern
      float bayer4( vec2 p ) {
        int x = int( mod( p.x, 4.0 ) ), y = int( mod( p.y, 4.0 ) );
        int i = x + y * 4;
        float m[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
        return m[i] / 16.0;
      }
      float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

      void main() {
        vec2 d = vUv - 0.5;
        float edge = dot( d, d );
        // Slight colour fringing toward the edges, like a cheap lens
        vec3 col;
        col.r = texture2D( tScene, vUv + d * edge * fringe * 8.0 ).r;
        col.g = texture2D( tScene, vUv ).g;
        col.b = texture2D( tScene, vUv - d * edge * fringe * 8.0 ).b;

        gl_FragColor = vec4( col * exposure, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 c = gl_FragColor.rgb;

        // Grade: washed out, slightly sickly, with murky lifted blacks
        float lum = dot( c, vec3( 0.299, 0.587, 0.114 ) );
        c = mix( vec3( lum ), c, saturation ) * tint;
        c = c * ( 1.0 - lift ) + lift * vec3( 0.8, 1.0, 0.85 );

        // Vignette
        c *= 1.0 - vignette * smoothstep( 0.18, 0.72, length( d * vec2( 1.15, 1.0 ) ) );

        // Film grain (changes every frame)
        c += ( hash( gl_FragCoord.xy + fract( time * 7.13 ) * 113.0 ) - 0.5 ) * grain;

        // Limited colour depth with ordered dithering
        float t = mix( 0.5, bayer4( gl_FragCoord.xy ), dither );
        c = floor( c * levels + t ) / levels;

        gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();

  return {
    /** Prepare every shader up front (for the off-screen image and the look pass). */
    async compile(scene, camera) {
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      await renderer.compileAsync(quadScene, quadCamera);
    },
    render(scene, camera, time) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      material.uniforms.time.value = time;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
  };
}
