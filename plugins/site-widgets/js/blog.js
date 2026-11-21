/* Reads published posts from the Planet Grid app: /public/blog/<domain>/posts.json */
(function(){var box=document.querySelectorAll('[data-blog]');if(!box.length)return;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
box.forEach(function(b){var api='https://api.planet-grid.com/public/blog/'+b.dataset.blog+'/posts.json',n=+b.dataset.limit||12;
fetch(api).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){var ps=(d.posts||[]).slice(0,n);if(!ps.length)throw 0;
b.innerHTML=ps.map(function(p){var img=p.cover_image||p.og_image||p.image||'',u=p.url||('https://api.planet-grid.com/public/blog/'+b.dataset.blog+'/posts/'+encodeURIComponent(p.slug)+'.json'),dt=p.publish_at?new Date(p.publish_at).toLocaleDateString('en-ZA',{day:'numeric',month:'long',year:'numeric'}):'';
return '<article class="card post">'+(img?'<img src="'+esc(img)+'" alt="'+esc(p.cover_alt||'')+'" loading="lazy" width="640" height="360">':'')+'<p class="small muted">'+(dt?'<time datetime="'+esc(p.publish_at)+'">'+dt+'</time>':'')+'</p><h3><a href="'+esc(u)+'">'+esc(p.title)+'</a></h3><p class="muted">'+esc(p.excerpt||p.meta_description||'')+'</p></article>'}).join('')}).catch(function(){})})})();
