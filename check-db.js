import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
    const { data: logs, error: logsErr } = await supabase
        .from('student_assignment_logs')
        .select('*, assignments(assignment_name, assignment_type)')
        .in('interaction_type', ['submission', 'discussion_post']);

    console.log("Logs error:", logsErr?.message);
    console.log("Logs count:", logs?.length);
    if (logs?.length > 0) {
        console.log("Sample log course_id:", logs[0].course_id);
        console.log("Sample log assignments:", logs[0].assignments);
    }

    const { data: students, error: studentsErr } = await supabase.from('students').select('*');
    console.log("Students error:", studentsErr?.message);
    console.log("Students count:", students?.length);
}

check();
