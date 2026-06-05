(async () => {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  await page.goto('http://localhost:3001');
  
  // Wait a bit for initial fetch
  await new Promise(r => setTimeout(r, 2000));
  
  const patientsCount = await page.evaluate(() => {
    return window.CounselFlow && window.CounselFlow.app ? window.CounselFlow.app.patients.length : -1;
  });
  console.log('Patients array length:', patientsCount);

  const securityScopedCount = await page.evaluate(() => {
    return window.CounselFlow && window.CounselFlow.app ? window.CounselFlow.app.getSecurityScopedPatients().length : -1;
  });
  console.log('Security scoped patients length:', securityScopedCount);

  await browser.close();
})();
