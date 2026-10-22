/* Release packaging, real mechanics and isolated saves: node tests/releases.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),keys=[];
for(const release of ['current','classic','improved','boost']){
  const dir=release==='current'?root:path.join(root,'versions',release);
  const c=vm.createContext({window:{}});
  for(const f of ['data','storage'])vm.runInContext(fs.readFileSync(path.join(dir,'js',f+'.js'),'utf8'),c);
  const H=c.window.HC;keys.push(H.SAVE_KEY);
  assert.equal(H.defaultState().settings.music,false);
  if (release === 'current' || release === 'boost') assert.equal(H.VERSION,release==='current'?'0.4.0':'0.3.0');
  if(release==='classic'){assert.equal(H.TRACKS.hills.amp,200);assert.equal(H.ECON.fuelPickup,0.16);}
  else{assert.equal(H.TRACKS.hills.amp,150);assert.equal(H.ECON.fuelPickup,0.35);}
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  for(const ref of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    const url=ref[1];if(/^(?:https?:|data:|#)/.test(url))continue;
    assert.ok(fs.existsSync(path.resolve(dir,url)),release+': missing '+url);
  }
  assert.ok(html.includes('data-version="'+release+'"'));
  console.log('✓ '+release+': packaged assets, music off and release mechanics');
}
assert.equal(new Set(keys).size,4);assert.equal(keys[0],'quiet-hills/save/v1');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),c);
for(const type of Object.keys(c.window.HC.BUILDINGS)){
  const bytes=fs.readFileSync(path.join(root,'assets/buildings',type+'.webp'));
  assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length>10000);
}
console.log('✓ Four unique save namespaces; all ten building assets present');
