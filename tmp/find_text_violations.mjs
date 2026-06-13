import { chromium } from 'playwright';
import fs from 'fs';

const htmlPath = "C:\\Users\\karth\\.gemini\\antigravity-ide\\brain\\8025e5cc-8850-4ec1-ab2c-bef45a9844be\\scratch\\graded_grading_hub.html";
const content = fs.readFileSync(htmlPath, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(content);

const results = await page.evaluate(() => {
  const tinyTextElements = [];
  const wideTrackingElements = [];
  
  const allElements = document.querySelectorAll('*');
  for (const node of allElements) {
    // Check if node has direct text content (excluding script/style)
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;
    
    let hasDirectText = false;
    let textContent = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim().length > 0) {
        hasDirectText = true;
        textContent += child.nodeValue.trim() + ' ';
      }
    }
    
    if (!hasDirectText) continue;
    textContent = textContent.trim();
    
    const style = window.getComputedStyle(node);
    
    // 1. Tiny text detection
    const fontSizePx = parseFloat(style.fontSize);
    // Standard scanner flags body text below 12px or 11px if it is mixed-case (not strictly uppercase)
    const hasLowercase = /[a-z]/.test(textContent);
    if (fontSizePx <= 11 && hasLowercase) {
      tinyTextElements.push({
        tag: node.tagName,
        classes: node.className,
        fontSize: style.fontSize,
        text: textContent.substring(0, 100)
      });
    }
    
    // 2. Wide tracking detection
    const letterSpacing = style.letterSpacing;
    if (letterSpacing && letterSpacing !== 'normal') {
      const spacingVal = parseFloat(letterSpacing);
      // If spacing > 1px (0.0625em for 16px font) and text is not uppercase (has lowercase)
      if (spacingVal > 0.8 && hasLowercase) {
        wideTrackingElements.push({
          tag: node.tagName,
          classes: node.className,
          letterSpacing,
          text: textContent.substring(0, 100)
        });
      }
    }
  }
  
  return { tinyTextElements, wideTrackingElements };
});

console.log("=== TINY TEXT VIOLATIONS ===");
console.log(JSON.stringify(results.tinyTextElements, null, 2));
console.log("\n=== WIDE TRACKING VIOLATIONS ===");
console.log(JSON.stringify(results.wideTrackingElements, null, 2));

await browser.close();
