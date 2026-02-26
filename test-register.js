import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function registerTest() {
    const { data, error } = await supabase.auth.signUp({
        email: 'john2@mail.usf.edu',
        password: 'password123',
        options: {
            data: {
                full_name: 'John Doe',
                role: 'student'
            }
        }
    });

    if (error) {
        fs.writeFileSync('output2.json', JSON.stringify({ error }, null, 2));
        return;
    }

    if (data.user) {
        const { error: upsertErr } = await supabase.from('students').upsert({
            id: data.user.id,
            student_name: 'John Doe',
            student_email: 'john2@mail.usf.edu',
            enrolled_courses: ['BIG_DATA_2026'],
            created_at: new Date().toISOString()
        });

        const { data: students } = await supabase.from('students').select('*');
        fs.writeFileSync('output2.json', JSON.stringify({ upsertErr, students, user: data.user.id }, null, 2));
    }
}

registerTest();
