import { chromium } from 'playwright';

(async () => {
  console.log('Starting debug browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  console.log('Navigating to login...');
  await page.goto('http://localhost:3000/teacher/login');
  await page.evaluate(() => localStorage.clear());
  
  await page.fill('input[type="email"]', 'dr.smith@educonnect.ai');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');

  console.log('Waiting for login and redirect to course selection...');
  await page.waitForTimeout(4000);
  
  const customApiKey = '13~TcnHE4GaQCYUKQMUV3mXeeh6rYQtXJQ9Nf4HEVNcWfYvCVCmmBuPu7vQX2GKAWXv';
  // Using system default / mock data
  
  console.log('Clicking Save & Refresh...');
  await page.click('text="Save & Refresh"');
  await page.waitForSelector('text="Enter Hub"', { timeout: 15000 });

  console.log('Clicking course CAP 6701...');
  await page.locator('button:has-text("CAP 6701")').first().click();
  await page.waitForTimeout(4000);

  console.log('Navigating to Grading Hub...');
  await page.goto('http://localhost:3000/teacher/grading');
  await page.waitForTimeout(10000);

  console.log('Dumping current buttons...');
  const buttons = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('button')).map(b => b.textContent);
  });
  console.log('Buttons on page:', buttons);

  console.log('Selecting Timeline of Key Developments assignment...');
  await page.evaluate(() => {
     const btns = Array.from(document.querySelectorAll('div.cursor-pointer, button'));
     const assnBtn = btns.find(b => b.textContent.includes('Lab 2'));
     if (assnBtn) {
       assnBtn.click();
       console.log('Clicked Timeline of Key Developments button');
     } else {
       console.log('Could not find Timeline of Key Developments button');
     }
  });
  await page.waitForTimeout(5000);

  console.log('Dumping text content of the central area...');
  const text = await page.evaluate(() => {
     return document.body.innerText;
  });
  console.log('Page inner text (truncated):', text.substring(0, 1500));

  await browser.close();
})();
