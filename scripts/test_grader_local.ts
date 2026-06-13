import { gradeWithMoEConsensus } from '../src/grader/moe_consensus.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const assignmentContext = "Write a comprehensive essay about the impact of artificial intelligence on modern society. Ensure you discuss both positive and negative implications, and provide specific real-world examples.";
    const studentSubmission = "Artificial intelligence has changed the world a lot. It makes things faster and easier for businesses. For example, AI can help doctors diagnose diseases. However, some people worry about losing their jobs to robots. Overall, I think AI is good but we need to be careful. In conclusion, AI is the future.";
    const maxPoints = 100;
    const rubric = [
        { criterion_id: "Content", dimension: "Quality of arguments and examples", max_score: 40 },
        { criterion_id: "Structure", dimension: "Organization and flow", max_score: 30 },
        { criterion_id: "Critical Thinking", dimension: "Depth of analysis", max_score: 30 }
    ];
    
    const attachmentSummary = "";
    const inlineDataParts: any[] = [];
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.error("No API key found");
        return;
    }
    
    console.log("Running MoE Consensus grader...");
    console.log("Assignment:", assignmentContext);
    console.log("Student Submission:", studentSubmission);
    console.log("Rubric:", rubric);
    console.log("------------------------------------------");
    
    try {
        const result = await gradeWithMoEConsensus(
            assignmentContext,
            studentSubmission,
            maxPoints,
            rubric,
            attachmentSummary,
            inlineDataParts,
            apiKey,
            "AI Impact Essay",
            "student_01"
        );
        console.log("=== RESULTS ===");
        console.log(`Suggested Grade: ${result.suggestedGrade} / ${maxPoints}`);
        console.log(`Feedback: ${result.feedback}`);
        console.log(`Rationale: ${result.deductionRationale}`);
        console.log("\n=== MOE SCORES ===");
        console.log(result.moeScores);
        
        console.log("\n=== DEBATE RESOLUTION ===");
        console.log(result.debateResolution);
        
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
