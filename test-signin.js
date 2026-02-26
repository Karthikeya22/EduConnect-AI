import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSignInAndUpsert() {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: 'test.student@usf.edu',
        password: 'password123'
    });

    if (authErr) {
        fs.writeFileSync('output3.json', JSON.stringify({ authErr }, null, 2));
        return;
    }

    const { error: upsertErr } = await supabase.from('students').upsert({
        id: authData.user.id,
        student_name: 'Test Student',
        student_email: 'test.student@usf.edu',
        enrolled_courses: ['BIG_DATA_2026']
    }, { onConflict: 'id' });

    fs.writeFileSync('output3.json', JSON.stringify({ upsertErr, user: authData.user.id }, null, 2));
}

testSignInAndUpsert();
