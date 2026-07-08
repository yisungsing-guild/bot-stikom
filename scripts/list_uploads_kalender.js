const fs = require('fs');
const path = require('path');

function walk(dir){
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const names = fs.readdirSync(dir);
  for (const n of names){
    const p = path.join(dir,n);
    try{
      const st = fs.statSync(p);
      if (st.isFile()) {
        if (/kalender/i.test(n)) out.push(p);
      } else if (st.isDirectory()) {
        out.push(...walk(p));
      }
    }catch(e){}
  }
  return out;
}

const found = walk(path.join(process.cwd(),'uploads'));
console.log(found.join('\n'));
