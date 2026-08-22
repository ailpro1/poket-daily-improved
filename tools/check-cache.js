/* Fails if any shipped asset is missing from the service worker precache. */
const fs=require('fs'),p=require('path'),root=p.join(__dirname,'..');
const sw=fs.readFileSync(p.join(root,'sw.js'),'utf8');
const listed=new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|png|webmanifest))'/g)].map(m=>m[1]));
const html=fs.readFileSync(p.join(root,'index.html'),'utf8');
const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(u=>!u.startsWith('http'));
const disk=[];
for(const dir of ['js','css','icons']) fs.readdirSync(p.join(root,dir)).forEach(f=>disk.push(dir+'/'+f));
const missing=[...new Set([...refs,...disk])].filter(f=>!listed.has(f)&&f!=='sw.js');
const ghosts=[...listed].filter(f=>f!=='./'&&!fs.existsSync(p.join(root,f)));
if(missing.length) console.log('MISSING from sw cache:',missing);
if(ghosts.length) console.log('LISTED but not on disk:',ghosts);
if(!missing.length&&!ghosts.length) console.log('Cache manifest covers every asset ('+listed.size+' entries).');
process.exit(missing.length||ghosts.length?1:0);
