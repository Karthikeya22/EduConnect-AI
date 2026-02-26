import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
    const { data: logs, error: logsErr } = await supabase
        .from('student_assignment_logs')
        .select('*')

    console.log("Total logs count:", logs?.length);
    if (logs?.length > 0) {
        console.log("Sample log interaction_type:", logs[0].interaction_type);
        console.log("Sample log course_id:", logs[0].course_id);
    }
}

check();
