import { chromium } from 'playwright';
import fs from 'fs';

const htmlPath = "C:\\Users\\karth\\.gemini\\antigravity-ide\\brain\\8025e5cc-8850-4ec1-ab2c-bef45a9844be\\scratch\\graded_grading_hub.html";
const content = fs.readFileSync(htmlPath, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(content);

const elements = await page.evaluate(() => {
  const result = [];
  const allElements = document.querySelectorAll('*');
  
  for (const node of allElements) {
    // Check if node has direct text child or is a text container
    let hasDirectText = false;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim().length > 0) {
        hasDirectText = true;
        break;
      }
    }
    
    if (!hasDirectText) continue;
    
    const style = window.getComputedStyle(node);
    const fg = style.color;
    
    if (fg === 'rgb(255, 255, 255)') {
      // Find computed background color by walking up
      let current = node;
      let actualBg = 'transparent';
      while (current) {
        const currentStyle = window.getComputedStyle(current);
        const bg = currentStyle.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          actualBg = bg;
          break;
        }
        current = current.parentElement;
      }
      
      // If parent background is white or transparent (default to white page background)
      if (actualBg === 'rgb(255, 255, 255)' || actualBg === 'transparent' || actualBg === 'rgba(0, 0, 0, 0)') {
        result.push({
          tag: node.tagName,
          classes: node.className,
          text: node.textContent.trim().substring(0, 100),
          fg,
          bg: actualBg
        });
      }
    }
  }
  return result;
});

console.log(JSON.stringify(elements, null, 2));
await browser.close();
