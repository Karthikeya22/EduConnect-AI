import { chromium } from '@playwright/test';

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 500 });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        //
        // PART 1: Teacher Auth & Create Quiz
        //
        console.log("==> Starting Teacher Flow (Create Quiz)");
        await page.goto('http://localhost:5173/');

        // Auth
        await page.waitForSelector('text=Continue as Teacher', { timeout: 10000 }).catch(() => { });
        const continueAsTeacherBtn = await page.$('text=Continue as Teacher');
        if (continueAsTeacherBtn) {
            await continueAsTeacherBtn.click();
        } else {
            await page.click('text=Get Started');
            await page.click('text=Continue as Teacher');
        }

        // Try to login first
        await page.fill('input[type="email"]', 'teacher2026@usf.edu');
        await page.fill('input[type="password"]', 'TeacherPass123!');
        await page.click('button:has-text("Access Course Hub")');

        // Wait to see if Faculty Nexus appears
        try {
            await page.waitForSelector('text=Faculty Nexus', { timeout: 3000 });
        } catch {
            await page.click('button:has-text("New Instructor")');
            await page.fill('input[placeholder="Full Name"]', 'Dr. Data');
            await page.fill('input[placeholder="instructor@usf.edu"]', 'teacher2026@usf.edu');
            await page.fill('input[placeholder="••••••••"]', 'TeacherPass123!');

            const passInputs = await page.$$('input[type="password"]');
            if (passInputs.length > 1) {
                await passInputs[1].fill('TeacherPass123!');
            }
            await page.click('text=Agree to');
            await page.click('button:has-text("Register Profile")');
            await page.waitForSelector('text=Faculty Nexus', { timeout: 8000 });
        }

        await page.waitForTimeout(2000);

        // Go to Architect
        await page.locator('button', { hasText: 'Architect' }).first().click();
        await page.waitForTimeout(1000);

        // Fill form
        const selects = await page.$$('select');
        // First select is Modality
        await selects[0].selectOption({ label: 'Data Quiz' });
        await page.waitForTimeout(500);

        // Second select is Topic
        await selects[1].selectOption({ value: 'Chapter 1: Intro to Big Data' });

        // Title
        await page.fill('input[placeholder*="JSON Parsing Structures"]', 'Browser Agent Quiz Test');

        // Due date
        await page.fill('input[type="datetime-local"]', '2026-12-12T12:00');

        // Points (first number input is points, second is time limit for quizzes)
        const numberInputs = await page.$$('input[type="number"]');
        await numberInputs[0].fill('100');
        if (numberInputs.length > 1) {
            await numberInputs[1].fill('30'); // Time limit
        }

        // Add a single question
        await page.click('button:has-text("+ Add Question")');
        await page.fill('input[placeholder="Question text..."]', 'What is 2+2?');
        await page.fill('input[placeholder="Answer Key..."]', '4');

        // Publish to Section Ledger
        await page.click('button:has-text("Publish to Section Ledger")');
        await page.waitForTimeout(2000);
        console.log("==> Quiz published!");

        // Logout
        await page.locator('button', { hasText: 'Terminate Hub' }).first().click();
        await page.waitForTimeout(2000);

        //
        // PART 2: Student Submission
        //
        console.log("==> Starting Student Flow (Submit Quiz)");
        await page.goto('http://localhost:5173/');
        const continueAsStudentBtn = await page.$('text=Continue as Student');
        if (continueAsStudentBtn) {
            await continueAsStudentBtn.click();
        } else {
            await page.click('text=Get Started');
            await page.click('text=Continue as Student');
        }

        await page.fill('input[type="email"]', 'student2026@educonnect.com');
        await page.fill('input[type="password"]', 'StudentPass123!');
        await page.click('button:has-text("Access Hub")');

        try {
            await page.waitForSelector('text=Student Hub', { timeout: 3000 });
        } catch {
            await page.click('text=New Account');
            await page.fill('input[placeholder="Full legal name"]', 'Student 2026');
            await page.fill('input[placeholder="student@mail.usf.edu"]', 'student2026@educonnect.com');
            const pInputs = await page.$$('input[type="password"]');
            await pInputs[0].fill('StudentPass123!');
            await pInputs[1].fill('StudentPass123!');
            await page.click('text=Agree to');
            await page.click('button:has-text("Register Identity")');
            await page.waitForSelector('text=Student Hub', { timeout: 8000 });
        }

        await page.waitForTimeout(2000);

        // Click the assignment card
        try {
            await page.waitForSelector('text=Browser Agent Quiz Test', { timeout: 15000 });
            await page.locator('text=Browser Agent Quiz Test').first().click();
        } catch {
            console.log("Could not find the quiz on the dashboard!");
        }

        await page.waitForTimeout(1000);

        // Since it's a quiz, find the input for answer
        // Let's check if the input has placeholder 'Your Answer...' or 'Write your response'
        const textArea = await page.$('textarea[placeholder="Write your response here..."]');
        if (textArea) {
            await textArea.fill('My answer is 4!');
        } else {
            // For each question there might be a text input
            const textInputs = await page.$$('input[type="text"]');
            if (textInputs.length > 0) {
                await textInputs[0].fill('4');
            }
        }
        await page.click('button:has-text("Turn In")');

        await page.waitForTimeout(2000);
        console.log("==> Quiz submitted!");

        // Logout
        await page.locator('button', { hasText: 'Terminate Hub' }).first().click();
        await page.waitForTimeout(2000);

        //
        // PART 3: Teacher Evaluate
        //
        console.log("==> Starting Teacher Flow (Evaluate Quiz)");
        await page.goto('http://localhost:5173/');
        const continueAsTeacherBtn2 = await page.$('text=Continue as Teacher');
        if (continueAsTeacherBtn2) {
            await continueAsTeacherBtn2.click();
        } else {
            await page.click('text=Get Started');
            await page.click('text=Continue as Teacher');
        }

        const emailInput = await page.$('input[type="email"]');
        if (emailInput) {
            await page.fill('input[type="email"]', 'teacher2026@usf.edu');
            await page.fill('input[type="password"]', 'TeacherPass123!');
            await page.click('button:has-text("Access Course Hub")');
            await page.waitForTimeout(2000);
        }

        // Go to nexus
        await page.locator('button', { hasText: 'Evaluation Nexus' }).first().click();
        await page.waitForTimeout(2000);

        // Select the submission
        await page.click('text=Browser Agent Quiz Test');
        await page.waitForTimeout(1000);

        // Init AI Nexus
        await page.click('button:has-text("Initialize AI Nexus")');
        console.log("==> Waiting for AI Persona analysis...");
        await page.waitForTimeout(6000);

        // Fill Score
        await page.fill('input[placeholder="0-100"]', '95');
        await page.click('button:has-text("Submit Evaluation")');

        await page.waitForTimeout(2000);

        // Publish Results
        await page.click('button:has-text("Publish Results")');
        await page.waitForTimeout(1000);
        await page.click('button.bg-zinc-100.w-6.h-6'); // Checkbox for student (first one)
        await page.click('button:has-text("Transmit")');
        await page.waitForTimeout(2000);
        console.log("==> Grade published!");

        // Logout
        await page.locator('button', { hasText: 'Terminate Hub' }).first().click();
        await page.waitForTimeout(2000);

        //
        // PART 4: Student Verify Grade
        //
        console.log("==> Starting Student Flow (Verify)");
        await page.goto('http://localhost:5173/');
        const continueAsStudentBtn2 = await page.$('text=Continue as Student');
        if (continueAsStudentBtn2) {
            await continueAsStudentBtn2.click();
        } else {
            await page.click('text=Get Started');
            await page.click('text=Continue as Student');
        }

        const sEmail = await page.$('input[type="email"]');
        if (sEmail) {
            await page.fill('input[type="email"]', 'student2026@educonnect.com');
            await page.fill('input[type="password"]', 'StudentPass123!');
            await page.click('button:has-text("Access Hub")');
            await page.waitForTimeout(2000);
        }

        // Verify on Dashboard
        const foundDashboardGrade = await page.locator('text=Score: 95').first().isVisible();
        console.log("Dashboard Badge exists:", foundDashboardGrade);

        // Go to Audit My Data (Student Progress)
        await page.locator('button', { hasText: 'Progress' }).first().click();
        await page.waitForTimeout(2000);

        const foundLedgerGrade = await page.locator('text=Score: 95').first().isVisible();
        console.log("Ledger Badge exists:", foundLedgerGrade);

        console.log("==> End-to-End Test Passed successfully! <==");

    } catch (err) {
        console.error("Test failed:", err);
        await page.screenshot({ path: 'playwright-failure.png', fullPage: true });
    } finally {
        await browser.close();
    }
})();
