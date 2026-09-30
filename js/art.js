/* Яркая долина: raster buildings + resolution-independent scenery and vehicles. */
window.HC = window.HC || {};
(function (HC) {
  'use strict';
  var root = new URL('../assets/buildings/', document.currentScript.src);
  var images = {};
  function ellipse(g,x,y,rx,ry,color) { g.fillStyle=color; g.beginPath(); g.ellipse(x,y,rx,ry,0,0,Math.PI*2); g.fill(); }
  function sphere(g,x,y,r,hi,lo,flat) {
    g.save(); g.translate(x,y); g.scale(1,flat || 1);
    var f=g.createRadialGradient(-r*.35,-r*.4,r*.05,0,0,r);
    f.addColorStop(0,hi); f.addColorStop(.55,hi); f.addColorStop(1,lo);
    g.fillStyle=f; g.beginPath(); g.arc(0,0,r,0,Math.PI*2); g.fill(); g.restore();
  }
  function flower(g,x,y,r,color) {
    g.strokeStyle='#288837'; g.lineWidth=1.8; g.beginPath(); g.moveTo(x,y); g.quadraticCurveTo(x+3,y-7,x,y-12); g.stroke();
    ellipse(g,x+3,y-5,4,1.8,'#8de24b');
    for(var j=0;j<5;j++){var a=j*Math.PI*2/5; sphere(g,x+Math.cos(a)*r*.85,y-12+Math.sin(a)*r*.85,r*.65,color,'#bc387e');}
    sphere(g,x,y-12,r*.45,'#fff99b','#ec9b16');
  }
  function flowers(g,x,y,scale) {
    g.save();g.translate(x,y);g.scale(scale,scale);
    flower(g,-10,1,3.8,'#ff73cc');flower(g,3,0,4.2,'#fff174');flower(g,12,3,3.3,'#ffae3c');g.restore();
  }
  var oldDecor=HC.Decor.draw;
  HC.Decor.draw=function(g,type,P,scale,flip){
    if(!P.vivid || !/^(tree|pine|bush|grass|rock|cactus|flowers|lamp|crates|fence)$/.test(type)) {oldDecor.call(this,g,type,P,scale,flip);return;}
    g.save();g.scale((flip?-1:1)*(scale||1),scale||1);
    if(type==='tree'){
      ellipse(g,3,1,24,4,'#185c3333');
      var bark=g.createLinearGradient(-7,0,7,0);bark.addColorStop(0,'#9b5829');bark.addColorStop(.5,'#dca059');bark.addColorStop(1,'#774020');
      g.fillStyle=bark;g.beginPath();g.moveTo(-7,1);g.lineTo(-4,-38);g.lineTo(5,-38);g.lineTo(9,1);g.closePath();g.fill();
      sphere(g,-16,-43,23,'#8fe747','#278c36',.9);sphere(g,16,-47,23,'#70dc38','#197c33',.9);
      sphere(g,0,-66,25,'#b0f15a','#35a83c',.9);sphere(g,-7,-44,20,'#85e443','#238e31',.87);
      ellipse(g,-13,-71,6,3,'#d6ff8c66');sphere(g,15,-47,3,'#ff995c','#e75536');sphere(g,-17,-45,3,'#ff995c','#e75536');
      flowers(g,-7,2,.7);
    } else if(type==='pine'){
      g.fillStyle='#956035';g.fillRect(-4,-17,8,19);
      for(var i=0;i<3;i++){
        var y=-12-i*18,w=25-i*6;
        var gr=g.createLinearGradient(-w,y-26,w,y);gr.addColorStop(0,'#9be651');gr.addColorStop(.45,'#40b742');gr.addColorStop(1,'#147841');
        g.fillStyle=gr;g.beginPath();g.moveTo(0,y-32);g.quadraticCurveTo(-w*.7,y-6,-w,y);g.quadraticCurveTo(0,y+7,w,y);g.quadraticCurveTo(w*.5,y-11,0,y-32);g.fill();
        g.strokeStyle='#bafa7380';g.lineWidth=2;g.beginPath();g.moveTo(0,y-27);g.lineTo(-w*.8,y-2);g.stroke();
      }
    } else if(type==='bush'){
      sphere(g,-10,-8,12,'#9ee94a','#258d35',.8);sphere(g,9,-9,14,'#83df3d','#187d36',.8);sphere(g,-1,-16,12,'#b2f55b','#35a83c',.8);flowers(g,0,1,.65);
    } else if(type==='grass'||type==='flowers'){
      g.strokeStyle='#66c638';g.lineWidth=3;g.lineCap='round';
      for(var k=-2;k<3;k++){g.beginPath();g.moveTo(k*5,0);g.quadraticCurveTo(k*6,-7,k*8,-13-Math.abs(k)*2);g.stroke();}
      flowers(g,0,1,.8);
    } else if(type==='lamp'){
      g.fillStyle='#704d30';g.fillRect(-3,-46,6,48);g.fillStyle='#bb8e53';g.fillRect(-3,-46,2,46);
      g.fillStyle='#5a4030';g.beginPath();g.roundRect(-10,-60,20,20,4);g.fill();
      var light=g.createLinearGradient(0,-58,0,-43);light.addColorStop(0,'#fff6a3');light.addColorStop(1,'#ffc858');g.fillStyle=light;g.fillRect(-6,-56,12,12);
      g.fillStyle='#d16a31';g.beginPath();g.moveTo(-14,-59);g.lineTo(0,-70);g.lineTo(14,-59);g.closePath();g.fill();
      g.strokeStyle='#f2ae4c';g.lineWidth=2;g.beginPath();g.moveTo(-11,-60);g.lineTo(0,-68);g.stroke();
      ellipse(g,0,0,8,3,'#4b713e');
    } else if(type==='crates'){
      for(var b=0;b<2;b++){
        var bx=b*19-17,by=b*-9;g.fillStyle='#86512a';g.fillRect(bx,by-20,22,22);g.fillStyle='#d9a254';g.fillRect(bx,by-20,18,18);
        g.strokeStyle='#f4ca7b';g.lineWidth=2;g.strokeRect(bx+2,by-18,14,14);g.beginPath();g.moveTo(bx+3,by-17);g.lineTo(bx+15,by-5);g.stroke();
      }
    } else if(type==='fence'){
      g.strokeStyle='#8a552f';g.lineWidth=6;g.lineCap='round';g.beginPath();g.moveTo(-25,-13);g.lineTo(25,-13);g.moveTo(-25,-26);g.lineTo(25,-26);g.stroke();
      g.strokeStyle='#d9a667';g.lineWidth=7;g.beginPath();g.moveTo(-23,0);g.lineTo(-23,-34);g.moveTo(23,0);g.lineTo(23,-34);g.stroke();
      g.strokeStyle='#ffe0a3';g.lineWidth=2;g.beginPath();g.moveTo(-25,-33);g.lineTo(-25,-2);g.moveTo(21,-33);g.lineTo(21,-2);g.stroke();
    } else if(type==='rock'){
      var rg=g.createLinearGradient(-20,-25,18,3);rg.addColorStop(0,'#d6e4e5');rg.addColorStop(.5,'#a8bec5');rg.addColorStop(1,'#617e91');
      g.fillStyle=rg;g.beginPath();g.moveTo(-23,0);g.lineTo(-18,-15);g.lineTo(-2,-26);g.lineTo(17,-19);g.lineTo(24,-2);g.lineTo(9,4);g.closePath();g.fill();
      g.strokeStyle='#ecfaff';g.lineWidth=2;g.beginPath();g.moveTo(-15,-14);g.lineTo(-2,-22);g.lineTo(13,-17);g.stroke();ellipse(g,-10,0,10,3,'#66b43c');
    } else if(type==='cactus'){
      g.lineCap='round';g.strokeStyle='#177e58';g.lineWidth=17;g.beginPath();g.moveTo(0,0);g.lineTo(0,-56);g.moveTo(-1,-20);g.lineTo(-18,-25);g.lineTo(-18,-41);g.moveTo(1,-34);g.lineTo(16,-39);g.lineTo(16,-49);g.stroke();
      g.strokeStyle='#6fd969';g.lineWidth=7;g.beginPath();g.moveTo(-3,-2);g.lineTo(-3,-55);g.moveTo(-19,-28);g.lineTo(-19,-40);g.stroke();flower(g,1,-52,4,'#ff84d6');
    }
    g.restore();
  };

  var Art=HC.Art={
    images:images,
    ensure:function(type){
      if (images[type]) return images[type];
      var im = new Image(); images[type] = im; im.decoding = 'async';
      im.onload = function () { HC.Base._thumbs = {}; };
      im.src = new URL(type + '.webp', root).href;
      return im;
    },
    init:function(state){
      var self = this;
      state.base.plots.forEach(function (plot) { if (plot) self.ensure(plot.type); });
      this.ensure('mine');
    },
    building:function(g,type,x,y,size,flip){
      var im=images[type];if(!im || !im.complete || !im.naturalWidth)return false;
      g.save();g.translate(x,y);if(flip)g.scale(-1,1);
      g.drawImage(im,-size/2,-size*.86,size,size);g.restore();return true;
    },
    flowers:flowers,
    sphere:sphere,
    vehicle:function(g,P,car){
      var def=car.def,colors=[['#ff8c56','#f44735','#a92b37'],['#9fefff','#28bedd','#147191'],['#fff392','#ffc033','#bd701c'],['#c5a1ff','#975bea','#5839a4'],['#f1faff','#b6dce9','#6097ba']][def.order||0];
      if(car.terrain){var gy=car.terrain.height(car.pos.x),up=Math.max(0,gy-car.pos.y);g.save();g.globalAlpha=Math.max(.04,.3-up/600);ellipse(g,car.pos.x+6,gy-2,55+up*.12,7,P.shadow);g.restore();}
      // Suspension keeps the exact simulated wheel positions.
      g.strokeStyle='#384554';g.lineWidth=5;g.lineCap='round';
      def.axles.forEach(function(a,i){var c=Math.cos(car.ang),s=Math.sin(car.ang);g.beginPath();g.moveTo(car.pos.x+a.x*c-a.y*s,car.pos.y+a.x*s+a.y*c);g.lineTo(car.wheels[i].pos.x,car.wheels[i].pos.y);g.stroke();});
      car.wheels.forEach(function(w){
        g.save();g.translate(w.pos.x,w.pos.y);g.rotate(w.spinAngle);
        sphere(g,2,2,w.r+1,'#3e4e61','#101b2c');
        g.strokeStyle='#637187';g.lineWidth=3;
        for(var i=0;i<12;i++){var a=i*Math.PI/6;g.beginPath();g.moveTo(Math.cos(a)*(w.r-4),Math.sin(a)*(w.r-4));g.lineTo(Math.cos(a)*w.r,Math.sin(a)*w.r);g.stroke();}
        sphere(g,-1,-1,w.r*.53,'#f3fbff','#829dad');
        g.strokeStyle='#587283';g.lineWidth=2.8;
        for(var j=0;j<5;j++){var b=j*Math.PI*2/5;g.beginPath();g.moveTo(-1,-1);g.lineTo(Math.cos(b)*w.r*.4-1,Math.sin(b)*w.r*.4-1);g.stroke();}
        sphere(g,-1,-1,w.r*.16,'#ffe57a','#ca8a26');g.restore();
      });
      g.save();g.translate(car.pos.x,car.pos.y);g.rotate(car.ang);
      function body(dx,dy){g.beginPath();def.body.forEach(function(p,i){if(i)g.lineTo(p[0]+dx,p[1]+dy);else g.moveTo(p[0]+dx,p[1]+dy);});g.closePath();}
      body(4,-4);g.fillStyle=colors[2];g.fill();
      var top=Math.min.apply(null,def.body.map(function(p){return p[1];}));
      var bg=g.createLinearGradient(0,top-3,0,15);bg.addColorStop(0,colors[0]);bg.addColorStop(.42,colors[1]);bg.addColorStop(1,colors[2]);
      body(0,0);g.fillStyle=bg;g.fill();g.strokeStyle=colors[2];g.lineWidth=2;g.lineJoin='round';g.stroke();
      g.save();body(0,0);g.clip();
      g.strokeStyle='#ffffff85';g.lineWidth=3;g.beginPath();g.moveTo(-60,top+5);g.lineTo(60,top+5);g.stroke();
      g.fillStyle='#ffffffbb';g.fillRect(-44,1,74,3);
      g.fillStyle=colors[2];g.fillRect(-10,-12,2,23);g.fillStyle='#ffe898';g.fillRect(-21,-6,8,3);
      g.restore();
      var max=Math.max.apply(null,def.body.map(function(p){return p[0];}));
      sphere(g,max-2,-5,4,'#fffed2','#e6af43');
      g.fillStyle='#b4cbd5';g.fillRect(max-7,8,12,5);g.fillStyle='#ffdd6e';g.fillRect(max-3,9,5,3);
      // A little helmeted explorer replaces the stick figure.
      var hx=def.head[0],hy=def.head[1];
      g.fillStyle='#286da8';g.beginPath();g.roundRect(hx-7,hy+11,15,20,5);g.fill();
      g.strokeStyle='#ffd49b';g.lineWidth=4;g.beginPath();g.moveTo(hx+4,hy+16);g.lineTo(hx+16,hy+24);g.stroke();
      sphere(g,hx,hy+4,9,'#ffe5bc','#e6a263');
      g.fillStyle='#fff08a';g.beginPath();g.arc(hx,hy+2,10,Math.PI,0);g.lineTo(hx+13,hy+2);g.lineTo(hx-10,hy+2);g.closePath();g.fill();
      g.strokeStyle='#cd942d';g.lineWidth=2;g.beginPath();g.moveTo(hx-11,hy+2);g.lineTo(hx+13,hy+2);g.stroke();
      ellipse(g,hx+5,hy+4,1.3,1.8,'#302e40');ellipse(g,hx+8,hy+8,2.5,1,'#ce8759');
      g.restore();
    }
  };

  // All three gameplay releases remain frozen; only the current scene uses these overrides.
  HC.DECOR_SETS.hills.push('flowers','flowers','bush');
  HC.DECOR_SETS.forest.push('flowers','flowers');
  var oldClouds=HC.drawClouds;
  HC.drawClouds=function(g,W,H,P,offset,horizon,time){
    if(!P.vivid){oldClouds(g,W,H,P,offset,horizon,time);return;}
    g.save();var span=W+800;
    for(var i=0;i<7;i++){
      var x=((i*317-offset*.1-(time||0)*4)%span+span)%span-250,y=35+(i%3)*horizon*.22,s=.7+(i%3)*.25;
      g.save();g.translate(x,y);g.scale(s,s);sphere(g,0,6,26,'#ffffff','#b3e6f9',.6);sphere(g,31,2,33,'#ffffff','#ccefff',.7);sphere(g,61,9,23,'#ffffff','#bde8fa',.65);g.restore();
    }g.restore();
  };
  function iso(x,y){return {x:(x-y)*64,y:(x+y)*32};}
  var oldTiles=HC.Base.drawTiles;
  HC.Base.drawTiles=function(g,P){
    if(!P.vivid){oldTiles.call(this,g,P);return;}
    g.save();g.lineCap='round';g.lineJoin='round';
    for(var layer=0;layer<2;layer++){
      g.strokeStyle=layer?'#f2d59c':'#69a332';g.lineWidth=layer?26:32;
      for(var ax=0;ax<2;ax++)for(var road=0;road<(ax?13:19);road+=3){
        var a=ax?iso(0,road+.5):iso(road+.5,0),b=ax?iso(19,road+.5):iso(road+.5,13);
        g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
      }
    }
    g.strokeStyle='#b29b6944';g.lineWidth=1.4;
    for(var gx=0;gx<19;gx++)for(var gy=0;gy<13;gy++){
      if(gx%3 && gy%3)continue;var c=iso(gx+.5,gy+.5);
      g.beginPath();g.moveTo(c.x-7,c.y-3);g.lineTo(c.x+3,c.y+2);g.stroke();
    }
    for(var i=0;i<32;i++){
      var fx=(i*7)%19+.25,fy=(i*5)%13+.2;
      if(Math.floor(fx)%3!==0 && Math.floor(fy)%3!==0)continue;
      var p=iso(fx,fy);flowers(g,p.x,p.y,.7+(i%3)*.15);
    }
    g.restore();
  };
  var oldRim=HC.Base.drawRim;
  HC.Base.drawRim=function(g,P){
    if(!P.vivid){oldRim.call(this,g,P);return;}
    function edge(a,b,gate){
      var count=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/32);
      for(var i=0;i<=count;i++){
        var f=i/count;if(gate && f>.41 && f<.59)continue;
        var x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;
        g.fillStyle='#7d9096';g.beginPath();g.moveTo(x-14,y-7);g.lineTo(x,y);g.lineTo(x+14,y-7);g.lineTo(x+14,y+8);g.lineTo(x,y+15);g.lineTo(x-14,y+8);g.closePath();g.fill();
        g.fillStyle='#c3d5cc';g.beginPath();g.moveTo(x,y-14);g.lineTo(x+14,y-7);g.lineTo(x,y);g.lineTo(x-14,y-7);g.closePath();g.fill();
        g.strokeStyle='#e4eeda';g.lineWidth=1;g.beginPath();g.moveTo(x-12,y-7);g.lineTo(x,y-12);g.lineTo(x+12,y-7);g.stroke();
      }
    }
    g.save();edge(iso(0,0),iso(19,0));edge(iso(0,0),iso(0,13));edge(iso(19,0),iso(19,13),true);edge(iso(0,13),iso(19,13));g.restore();
  };
  var oldEmpty=HC.Base.drawEmpty;
  HC.Base.drawEmpty=function(g,s,P){
    if(!P.vivid){oldEmpty.call(this,g,s,P);return;}
    g.save();g.translate(s.x,s.y-32);ellipse(g,0,4,24,10,'#286d3133');sphere(g,0,0,18,'#fff19c','#d6a23e');
    g.strokeStyle='#81602d';g.lineWidth=3.5;g.lineCap='round';g.beginPath();g.moveTo(-7,0);g.lineTo(7,0);g.moveTo(0,-7);g.lineTo(0,7);g.stroke();g.restore();
  };
  var oldFolk=HC.Base.drawFolk;
  HC.Base.drawFolk=function(g,P,it){
    if(!P.vivid){oldFolk.call(this,g,P,it);return;}
    var st=Math.sin(this.t*7.4+it.n*2.1);g.save();g.translate(it.x,it.y);g.scale(it.back?-1:1,1);
    ellipse(g,0,1,7,3,'#185b3533');g.strokeStyle='#56391f';g.lineWidth=4;g.lineCap='round';g.beginPath();g.moveTo(-2,-11);g.lineTo(-st*3,0);g.moveTo(2,-11);g.lineTo(st*3,0);g.stroke();
    sphere(g,0,-18,8,['#65b9f6','#ff9463','#ac83ed'][it.n%3],'#425a8a',1.2);sphere(g,0,-30,6,'#ffe7ba','#e4a061');ellipse(g,0,-35,7,3,'#f2d16b');g.restore();
  };
  var oldItem=HC.Ride.drawItem;
  HC.Ride.drawItem=function(g,it,P){
    if(!P.vivid){oldItem.call(this,g,it,P);return;}
    g.save();g.translate(it.x,it.y+Math.sin(this.time*2+it.x*.01)*2);
    if(it.type==='coin'){
      sphere(g,1,2,12,'#c99722','#965b13');sphere(g,-1,-1,11,'#fff18d','#efb52b');g.strokeStyle='#c48b1d';g.lineWidth=1.5;g.beginPath();g.arc(-1,-1,7,0,6.3);g.stroke();g.fillStyle='#fff6ba';g.font='900 13px system-ui';g.textAlign='center';g.fillText('★',-1,4);
    }else if(it.type==='ore'){
      var grad=g.createLinearGradient(-9,-14,12,12);grad.addColorStop(0,'#ebb5ff');grad.addColorStop(.45,'#bb6ded');grad.addColorStop(1,'#6c3fb0');g.fillStyle=grad;g.beginPath();g.moveTo(0,-16);g.lineTo(12,-4);g.lineTo(8,12);g.lineTo(-8,12);g.lineTo(-12,-4);g.closePath();g.fill();g.strokeStyle='#f2c7ff';g.lineWidth=1.5;g.beginPath();g.moveTo(0,-15);g.lineTo(0,9);g.moveTo(-10,-4);g.lineTo(10,-4);g.stroke();
    }else if(it.type==='fuel'){
      g.fillStyle='#b02f35';g.beginPath();g.roundRect(-10,-14,23,29,4);g.fill();var red=g.createLinearGradient(-12,-14,10,12);red.addColorStop(0,'#ff9870');red.addColorStop(.5,'#f04c43');red.addColorStop(1,'#c12e37');g.fillStyle=red;g.beginPath();g.roundRect(-12,-16,22,28,4);g.fill();g.strokeStyle='#973137';g.lineWidth=3;g.beginPath();g.moveTo(1,-16);g.lineTo(6,-23);g.lineTo(13,-20);g.stroke();g.fillStyle='#ffe89b';g.fillRect(-8,-7,14,10);g.fillStyle='#dc6939';g.fillRect(-3,-5,4,6);
    }g.restore();
  };
})(window.HC);
