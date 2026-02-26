import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function clean() {
    console.log('Attempting to delete student_assignment_logs...');
    let { error: err1 } = await supabase.from('student_assignment_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err1) console.error('logs error:', err1);
    else console.log('Successfully deleted logs.');

    console.log('Attempting to delete assignments...');
    let { error: err2 } = await supabase.from('assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err2) console.error('assignments error:', err2);
    else console.log('Successfully deleted assignments.');
}

clean();
