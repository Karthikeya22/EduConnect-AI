import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSession() {
    const { data, error } = await supabase.auth.signUp({
        email: 'john3@mail.usf.edu',
        password: 'password123',
        options: {
            data: {
                full_name: 'John Doe',
                role: 'student'
            }
        }
    });

    fs.writeFileSync('output4.json', JSON.stringify({ session_exists: !!data?.session, user_exists: !!data?.user }, null, 2));
}

testSession();
