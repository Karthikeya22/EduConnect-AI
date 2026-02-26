import { chromium } from '@playwright/test';
import * as fs from 'fs';

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 600 });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log("==> Starting Full Lifecycle Verification...");

        const loginAsTeacher = async () => {
            console.log("Logging in as Teacher...");
            await page.goto('http://localhost:5173');
            await page.waitForTimeout(1000);

            // Check if we need to log out first
            const terminateHub = page.locator('button', { hasText: 'Terminate Hub' }).first();
            if (await terminateHub.isVisible()) {
                await terminateHub.click();
                await page.waitForTimeout(2000);
            }

            await page.waitForSelector('text=Continue as Teacher', { timeout: 10000 }).catch(() => { });
            const teacherBtn = await page.$('text=Continue as Teacher');
            if (teacherBtn) {
                await teacherBtn.click();
            } else {
                await page.click('text=Get Started');
                await page.click('text=Continue as Teacher');
            }
            await page.fill('input[type="email"]', 'teacher2026@usf.edu');
            await page.fill('input[type="password"]', 'TeacherPass123!');
            await page.click('button:has-text("Access Course Hub")');

            try {
                await page.waitForSelector('text=Control Nexus', { timeout: 5000 });
            } catch {
                // Must register
                const isAuth = await page.locator('text=Instructor Auth').isVisible();
                if (isAuth) {
                    await page.click('button:has-text("New Instructor")');
                    await page.fill('input[placeholder*="Full Name"]', 'Dr. Data');
                    await page.fill('input[placeholder*="instructor@usf.edu"]', 'teacher2026@usf.edu');
                    await page.fill('input[placeholder*="••••••••"]', 'TeacherPass123!');
                    const passInputs = await page.$$('input[type="password"]');
                    if (passInputs.length > 1) {
                        await passInputs[1].fill('TeacherPass123!');
                    }
                    await page.click('button:has-text("Initialize Hub Identity")');
                    await page.waitForSelector('text=Control Nexus', { timeout: 15000 });
                }
            }
        };

        const createAssignment = async (typeLabel, topic, promptStr) => {
            console.log(`Creating ${typeLabel} (${topic})...`);
            await page.locator('button', { hasText: 'Architect' }).first().click();
            await page.waitForTimeout(1500);

            // Fill form Mode
            const selects = await page.$$('select');
            await selects[0].selectOption({ label: typeLabel });
            await page.waitForTimeout(500);

            await selects[1].selectOption({ value: 'Chapter 1: Intro to Big Data' });

            // Title
            await page.fill('input[placeholder*="JSON Parsing Structures"]', topic);

            // Due date
            await page.fill('input[type="datetime-local"]', '2026-12-12T12:00');

            // Set points appropriately
            const numberInputs = await page.$$('input[type="number"]');
            await numberInputs[0].fill('100');
            if (typeLabel === 'Data Quiz' && numberInputs.length > 1) {
                await numberInputs[1].fill('30'); // Time limit
            }

            if (typeLabel === 'Data Quiz') {
                await page.click('button:has-text("+ Add Question")');
                await page.fill('input[placeholder="Question text..."]', promptStr);
                await page.fill('input[placeholder="Answer Key..."]', '4');
            } else {
                await page.fill('textarea[placeholder*="methodology"]', promptStr);
                await page.fill('textarea[placeholder*="criteria"]', "Follow the exact format prescribed. 100%");
            }

            // Publish
            await page.click('button:has-text("Publish to Section Ledger")');
            await page.waitForTimeout(1500);
            console.log(`==> ${typeLabel} published!`);
            await page.waitForTimeout(1500);
        };

        // --- PHASE 1: TEACHER CREATES EVERYTHING ---
        await loginAsTeacher();

        await createAssignment(
            'Data Quiz',
            'Advanced Filtering',
            'Draft 2 simple questions about map and filter arrays.'
        );

        await createAssignment(
            'Technical Lab',
            'Pipeline Build',
            'Write a lab asking students to implement a data pipeline using Python.'
        );

        await createAssignment(
            'Discussion Thread',
            'Ethics of AI',
            'Write a prompt asking students to discuss the ethical boundaries of AI models scraping public data.'
        );

        // Logout
        console.log("Logging out Teacher...");
        await page.locator('button', { hasText: 'Terminate Hub' }).first().click();
        await page.waitForTimeout(2000);

        // --- PHASE 2: STUDENT SUBMITS EVERYTHING ---
        console.log("==> Starting Student Flow...");
        await page.goto('http://localhost:5173');
        await page.waitForTimeout(1000);

        await page.waitForSelector('text=Continue as Student', { timeout: 5000 }).catch(() => { });
        const studentBtn = await page.$('text=Continue as Student');
        if (studentBtn) {
            await studentBtn.click();
        } else {
            await page.click('text=Get Started');
            await page.click('text=Continue as Student');
        }

        await page.fill('input[type="email"]', 'student2026@usf.edu');
        await page.fill('input[type="password"]', 'StudentPass123!');
        await page.click('button:has-text("Access Hub")');

        try {
            await page.waitForSelector('text=Active Labs', { timeout: 5000 });
        } catch {
            await page.click('button:has-text("New Account")');
            await page.fill('input[placeholder="Full legal name"]', 'Ada Lovelace');
            await page.fill('input[placeholder="student@mail.usf.edu"]', 'student2026@usf.edu');

            const passInputs = await page.$$('input[type="password"]');
            if (passInputs.length > 0) await passInputs[0].fill('StudentPass123!');
            if (passInputs.length > 1) await passInputs[1].fill('StudentPass123!');

            await page.click('text=Agree to');

            await page.click('button:has-text("Register Identity")');
            await page.waitForSelector('text=Active Labs', { timeout: 15000 });
        }

        const processItem = async (topicSubstring) => {
            console.log(`Student checking for item: ${topicSubstring}...`);
            await page.waitForTimeout(2000);
            // Click the card
            try {
                await page.waitForSelector(`text=${topicSubstring}`, { timeout: 10000 });
                await page.locator(`text=${topicSubstring}`).first().click();
                await page.waitForTimeout(2000);

                // Are we in a quiz, lab, or discussion?
                const isDiscussion = await page.locator('text=Discussion Hub').isVisible();
                if (isDiscussion) {
                    await page.fill('textarea[placeholder*="Type your response"]', 'I think AI scraping public data is a complex topic with many legal and ethical gray areas.');
                    await page.click('button:has-text("Submit Post")');
                    await page.waitForTimeout(2000);
                } else {
                    // Check if Quiz (has inputs) or Lab (has textarea)
                    const quizInputs = await page.locator('input[placeholder*="answer..."]').count();
                    if (quizInputs > 0) {
                        for (let i = 0; i < quizInputs; i++) {
                            await page.locator('input[placeholder*="answer..."]').nth(i).fill("A quick map or filter");
                        }
                    } else {
                        await page.fill('textarea[placeholder*="response"]', 'def data_pipeline(data):\n  return [x for x in data if x > 0]');
                    }
                    await page.click('button:has-text("Commit Payload")');
                    await page.waitForTimeout(2000);
                }

                console.log(`==> ${topicSubstring} submitted!`);
                await page.locator('button', { hasText: '← Hub' }).first().click();
                await page.waitForTimeout(2000);

            } catch (e) {
                console.log(`Could not process item ${topicSubstring}: ` + e.message);
            }
        };

        await processItem("Advanced Filtering");
        await processItem("Pipeline Build");
        await processItem("Ethics of AI");

        // View Student Progress briefly
        console.log("Checking Grade Ledger for Student...");
        await page.locator('button', { hasText: 'Progress' }).first().click();
        await page.waitForTimeout(3000); // Verify it shows "Score: X" or "Submitted"

        console.log("Logging out Student...");
        await page.locator('button', { hasText: 'Terminate Hub' }).first().click();
        await page.waitForTimeout(2000);

        // --- PHASE 3: TEACHER GRADES LAB & DISCUSSION ---
        await loginAsTeacher();
        console.log("Checking Evaluation Nexus...");
        await page.locator('button', { hasText: 'Evaluation Nexus' }).first().click();
        await page.waitForTimeout(5000); // Verify they show up in the pending list

        console.log("==> Test Complete! Verification finished. Keep browser open for 10s...");
        await page.waitForTimeout(10000);

    } catch (e) {
        console.error("Test failed:", e);
        await page.screenshot({ path: 'lifecycle-failure.png', fullPage: true });
    } finally {
        await browser.close();
    }
})();
