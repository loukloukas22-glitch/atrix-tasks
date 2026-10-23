// Δημιουργεί PNG εικονίδια από public/brand/icon_white.svg (σε μαύρο φόντο)
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch({ executablePath: process.env.CHROME || undefined }); const p = await b.newPage();
  const svg = fs.readFileSync('public/brand/icon_white.svg', 'utf8').replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
  for (const [n, f, pad] of [[512, 'icon-512', .2], [192, 'icon-192', .2], [180, 'icon-180', .16], [96, 'badge-96', .1], [32, 'favicon-32', .08]]) {
    await p.setViewportSize({ width: n, height: n });
    await p.setContent(`<body style="margin:0;background:#111111;width:${n}px;height:${n}px;display:flex;align-items:center;justify-content:center"><div style="width:${n*(1-2*pad)}px;height:${n*(1-2*pad)}px">${svg}</div></body>`);
    await p.screenshot({ path: `public/icons/${f}.png` }); }
  await b.close(); })();
