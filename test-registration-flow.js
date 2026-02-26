import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAfterDisable() {
    const email = `test.auto.${Date.now()}@usf.edu`;
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password: 'password123',
        options: {
            data: {
                full_name: 'Auto Gen Student',
                role: 'student'
            }
        }
    });

    const logs = { signUpErr, sessionExists: !!signUpData?.session, insertErr: null, afterStudents: null };

    if (signUpData?.session) {
        const { error: insertErr } = await supabase.from('students').insert({
            id: signUpData.user.id,
            student_name: 'Auto Gen Student',
            student_email: email,
            enrolled_courses: ['BIG_DATA_2026']
        });
        logs.insertErr = insertErr;

        const { data: afterStudents } = await supabase.from('students').select('*');
        logs.afterStudents = afterStudents;
    }

    fs.writeFileSync('output-diagnostic.json', JSON.stringify(logs, null, 2));
}

checkAfterDisable();
