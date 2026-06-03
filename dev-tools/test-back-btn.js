const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  
  await page.goto('http://localhost:3001');
  
  // Go to patients screen
  await page.click('[data-screen="patients"]');
  await new Promise(r => setTimeout(r, 500));
  
  // Click first patient
  await page.click('.patient-list-row');
  
  await new Promise(r => setTimeout(r, 500));
  
  console.log("Detail container display:", await page.$eval('#patients-view-detail-container', el => el.style.display));
  
  // Click back button
  await page.click('#btn-back-to-patients-list');
  await new Promise(r => setTimeout(r, 500));
  
  console.log("Detail container display after back:", await page.$eval('#patients-view-detail-container', el => el.style.display));
  console.log("List container display after back:", await page.$eval('#patients-view-list-container', el => el.style.display));
  
  await browser.close();
})();
