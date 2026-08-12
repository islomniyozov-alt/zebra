import { chromium } from 'playwright'
const BASE = 'https://zebra-dev.tajikcargollc.workers.dev'
const b = await chromium.launch({ executablePath: process.env.SHOT_CHROME })
const p = await (await b.newContext()).newPage()
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'})
await p.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await p.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await p.click('button[type="submit"]')
await p.waitForURL(/\/(loads|dashboard)/,{timeout:60000})
const times=[]
for (let i=0;i<5;i++){
  const t=Date.now()
  const r=await p.goto(`${BASE}/dashboard?nocache=${i}`,{waitUntil:'domcontentloaded'})
  times.push({status:r?.status(), ms:Date.now()-t})
}
console.log(JSON.stringify(times))
await b.close()
