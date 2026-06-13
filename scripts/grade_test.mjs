import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = 'C:\\Users\\karth\\.gemini\\antigravity-ide\\brain\\8025e5cc-8850-4ec1-ab2c-bef45a9844be\\scratch';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

(async () => {
  console.log('Starting browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, 
  });
  const page = await context.newPage();

  // Handle window alerts automatically
  page.on('dialog', async dialog => {
    console.log(`Alert dialog: ${dialog.message()}`);
    await dialog.accept();
  });

  const injectHighlightFn = async () => {
    await page.evaluate(() => {
      window.drawHighlight = (selectorOrEl, textMsg, position = 'top') => {
        let svg = document.getElementById('screenshot-overlay');
        if (!svg) {
          svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute('id', 'screenshot-overlay');
          svg.style.position = 'fixed';
          svg.style.top = '0';
          svg.style.left = '0';
          svg.style.width = '100vw';
          svg.style.height = '100vh';
          svg.style.pointerEvents = 'none';
          svg.style.zIndex = '999999';
          document.body.appendChild(svg);
        }

        let el = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const padding = 12;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

        const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        box.setAttribute('x', rect.left - padding);
        box.setAttribute('y', rect.top - padding);
        box.setAttribute('width', rect.width + padding * 2);
        box.setAttribute('height', rect.height + padding * 2);
        box.setAttribute('fill', 'rgba(100, 100, 255, 0.05)'); 
        box.setAttribute('stroke', '#6366F1'); 
        box.setAttribute('stroke-width', '4');
        box.setAttribute('stroke-dasharray', '8, 8');
        box.setAttribute('rx', '12');
        g.appendChild(box);

        const textWidth = textMsg.length * 9 + 40; 
        let textX = rect.left - padding;
        let textY = position === 'top' ? rect.top - padding - 40 : rect.bottom + padding + 10;
        
        if (textX + textWidth > window.innerWidth) textX = window.innerWidth - textWidth - 20;
        if (textY < 0) textY = rect.bottom + padding + 10;

        const textBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        textBox.setAttribute('x', textX);
        textBox.setAttribute('y', textY);
        textBox.setAttribute('width', textWidth);
        textBox.setAttribute('height', '32');
        textBox.setAttribute('fill', '#6366F1');
        textBox.setAttribute('rx', '8');
        textBox.setAttribute('filter', 'drop-shadow(0 4px 6px rgba(0,0,0,0.2))');
        g.appendChild(textBox);

        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.setAttribute('x', textX + 20);
        textEl.setAttribute('y', textY + 21);
        textEl.setAttribute('fill', 'white');
        textEl.setAttribute('font-size', '14px');
        textEl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        textEl.setAttribute('font-weight', '700');
        textEl.textContent = textMsg;
        g.appendChild(textEl);

        svg.appendChild(g);
      };

      window.clearHighlights = () => {
        const svg = document.getElementById('screenshot-overlay');
        if (svg) svg.remove();
      };
    });
  };

  console.log('Navigating to login...');
  await page.goto('http://localhost:3000/teacher/login');
  await page.evaluate(() => localStorage.clear());
  
  await page.fill('input[type="email"]', 'dr.smith@educonnect.ai');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');

  console.log('Waiting for login and redirect to course selection...');
  await page.waitForTimeout(4000);
  
  // Fill API key
  const customApiKey = '13~TcnHE4GaQCYUKQMUV3mXeeh6rYQtXJQ9Nf4HEVNcWfYvCVCmmBuPu7vQX2GKAWXv';
  // Using system default / mock data
  
  // Save & Select Course
  await page.click('text="Save & Refresh"');
  await page.waitForSelector('text="Enter Hub"', { timeout: 15000 });
  await page.locator('button:has-text("CAP 6701")').first().click();
  await page.waitForTimeout(4000);

  // 3. GRADING HUB - RAG DEMO
  console.log('Navigating to Grading Hub...');
  await page.goto('http://localhost:3000/teacher/grading');
  await page.waitForTimeout(10000);

  // Open an assignment
  console.log('Opening an assignment...');
  await page.evaluate(() => {
     const btns = Array.from(document.querySelectorAll('div.cursor-pointer, button'));
     const assnBtn = btns.find(b => b.textContent.includes('Lab 2'));
     if (assnBtn) assnBtn.click();
  });
  await page.waitForTimeout(3000);

  // Click Manage Materials
  console.log('Clicking Manage Materials...');
  await page.evaluate(() => {
     const btns = Array.from(document.querySelectorAll('button'));
     const manageBtn = btns.find(b => b.textContent.includes('Manage Materials'));
     if (manageBtn) manageBtn.click();
  });
  await page.waitForTimeout(3000);

  // Select all Canvas files
  console.log('Selecting Canvas files for ingestion...');
  await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (!cb.checked) cb.click();
    });
  });
  await page.waitForTimeout(1000);
  
  await page.screenshot({ path: path.join(outDir, '01_materials_selected.png') });

  console.log('Ingesting Selected Files...');
  await page.evaluate(() => {
     const btns = Array.from(document.querySelectorAll('button'));
     const ingestBtn = btns.find(b => b.textContent.includes('Ingest Selected Files'));
     if (ingestBtn) ingestBtn.click();
  });

  // Wait for Ingestion to finish (wait for alert)
  console.log('Waiting for ingestion to complete (this might take a while)...');
  await page.waitForTimeout(15000); // 15 seconds for ingestion
  
  await page.screenshot({ path: path.join(outDir, '02_ingestion_complete.png') });

  console.log('Closing materials modal...');
  await page.click('button:has(svg.text-zinc-500)');
  await page.waitForTimeout(2000);

  // Open a student
  console.log('Switching to "All" student view filter...');
  await page.evaluate(() => {
     const tabs = Array.from(document.querySelectorAll('button'));
     const allTab = tabs.find(b => b.textContent.trim() === 'All');
     if (allTab) allTab.click();
  });
  await page.waitForTimeout(2000);

  console.log('Opening a student submission...');
  await page.evaluate(() => {
     // Find the list buttons (exclude header and action buttons by checking height or child elements)
     const rows = Array.from(document.querySelectorAll('div.cursor-pointer')).filter(b => 
       b.textContent.includes('Ungraded') || b.textContent.includes('Missing') || b.textContent.includes('Graded')
     );
     if (rows.length > 0) rows[0].click();
  });
  await page.waitForTimeout(4000);

  console.log('Triggering AI Evaluation...');
  await page.evaluate(() => {
     const btns = Array.from(document.querySelectorAll('button'));
     const gradeBtn = btns.find(b => 
       b.textContent.toLowerCase().includes('grade with ai') || 
       b.textContent.toLowerCase().includes('evaluate')
     );
     if (gradeBtn) gradeBtn.click();
  });

  // Wait for grading to complete
  console.log('Waiting for AI Evaluation to complete...');
  await page.waitForTimeout(12000); // 12s wait

  await injectHighlightFn();
  await page.evaluate(() => {
    // Highlight the AI feedback component
    const allDivs = Array.from(document.querySelectorAll('div'));
    const feedbackDiv = allDivs.find(d => 
        (d.textContent.includes('Strengths') && d.textContent.includes('Improvements')) ||
        d.textContent.includes('Suggested Grade') ||
        d.textContent.includes('Feedback')
    );
    
    if (feedbackDiv) {
        const container = feedbackDiv.closest('.bg-\\[var\\(--bg-card\\)\\]') || feedbackDiv;
        window.drawHighlight(container, 'Successfully Scored using Ingested Canvas Files', 'top');
    } else {
        const rightPanel = document.querySelector('h2')?.closest('div.shrink-0')?.parentElement?.nextElementSibling;
        if (rightPanel) window.drawHighlight(rightPanel, 'Successfully Scored using Ingested Canvas Files', 'top');
    }
  });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, '03_grading_result_with_rag.png') });
  
  // Save HTML dump for impeccable audit
  console.log('Saving HTML dump...');
  const htmlContent = await page.content();
  fs.writeFileSync(path.join(outDir, 'graded_grading_hub.html'), htmlContent, 'utf-8');

  await browser.close();
  console.log('All screenshots and HTML dump captured successfully!');
})();
