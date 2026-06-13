import { chromium } from 'playwright';
import fs from 'fs';

const htmlPath = "C:\\Users\\karth\\.gemini\\antigravity-ide\\brain\\8025e5cc-8850-4ec1-ab2c-bef45a9844be\\scratch\\graded_grading_hub.html";
const content = fs.readFileSync(htmlPath, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(content);

const results = await page.evaluate(() => {
  const cards = [];
  const nested = [];
  
  const allElements = document.querySelectorAll('*');
  
  const getCardScore = (el) => {
    const style = window.getComputedStyle(el);
    let score = 0;
    
    // Background color check (non-transparent)
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score++;
    
    // Border check
    const borderTop = parseFloat(style.borderTopWidth || '0');
    const borderBottom = parseFloat(style.borderBottomWidth || '0');
    const borderLeft = parseFloat(style.borderLeftWidth || '0');
    const borderRight = parseFloat(style.borderRightWidth || '0');
    if (borderTop > 0 || borderBottom > 0 || borderLeft > 0 || borderRight > 0) score++;
    
    // Rounded corners check
    const rTopLeft = parseFloat(style.borderTopLeftRadius || '0');
    if (rTopLeft > 0) score++;
    
    // Shadow check
    const shadow = style.boxShadow;
    if (shadow && shadow !== 'none' && !shadow.includes('rgba(0, 0, 0, 0)')) score++;
    
    return { score, bg, borderTop, rTopLeft, shadow };
  };
  
  // Find all cards
  for (const el of allElements) {
    const cardMeta = getCardScore(el);
    if (cardMeta.score >= 3) {
      cards.push(el);
    }
  }
  
  // Find nested cards
  for (const card of cards) {
    let parent = card.parentElement;
    while (parent) {
      if (cards.includes(parent)) {
        const cMeta = getCardScore(card);
        const pMeta = getCardScore(parent);
        nested.push({
          childTag: card.tagName,
          childClasses: card.className,
          childScore: cMeta.score,
          parentTag: parent.tagName,
          parentClasses: parent.className,
          parentScore: pMeta.score,
          text: card.textContent.trim().substring(0, 60)
        });
        break;
      }
      parent = parent.parentElement;
    }
  }
  
  return { nested };
});

console.log("=== NESTED CARDS ===");
console.log(JSON.stringify(results.nested, null, 2));

await browser.close();
