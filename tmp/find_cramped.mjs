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
    const style = window.getComputedStyle(node);
    
    // Check if it's a block/flex/grid container with text
    const display = style.display;
    const text = node.textContent.trim();
    if (!text) continue;
    
    // Check background color and border
    const bg = style.backgroundColor;
    const borderTop = style.borderTopWidth;
    const borderBottom = style.borderBottomWidth;
    const borderLeft = style.borderLeftWidth;
    const borderRight = style.borderRightWidth;
    
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const hasBorder = (borderTop !== '0px' && borderTop !== '') ||
                      (borderBottom !== '0px' && borderBottom !== '') ||
                      (borderLeft !== '0px' && borderLeft !== '') ||
                      (borderRight !== '0px' && borderRight !== '');
                      
    if (hasBg || hasBorder) {
      const pTop = parseFloat(style.paddingTop || '0');
      const pBottom = parseFloat(style.paddingBottom || '0');
      const pLeft = parseFloat(style.paddingLeft || '0');
      const pRight = parseFloat(style.paddingRight || '0');
      
      // Let's check if display has flex, and padding is very small
      if (display.includes('flex') && (pTop < 4 || pBottom < 4 || pLeft < 4 || pRight < 4)) {
        result.push({
          tag: node.tagName,
          classes: node.className,
          text: node.textContent.trim().substring(0, 80),
          display,
          bg,
          padding: `${pTop}px ${pRight}px ${pBottom}px ${pLeft}px`
        });
      }
    }
  }
  return result;
});

console.log(JSON.stringify(elements, null, 2));
await browser.close();
