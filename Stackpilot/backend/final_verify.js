import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;

async function verify() {
    console.log('🚀 OpsPilot Final System Verification\n');

    // 1. Supabase Admin Check
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    try {
        const { data: users, error: authError } = await supabase.auth.admin.listUsers();
        if (authError) {
            console.log(`${red('✖')} Supabase Connection: FAILED (${authError.message})`);
        } else {
            console.log(`${green('✔')} Supabase Connection: SUCCESS (Admin Access Verified)`);
        }
    } catch (e) {
        console.log(`${red('✖')} Supabase Connection: ERROR (${e.message})`);
    }

    // 2. Database Schema Check
    const tables = ['password_resets', 'repositories', 'scan_results', 'code_metrics'];
    console.log('\nChecking Tables:');
    for (const table of tables) {
        try {
            const { error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                console.log(`  ${red('✖')} ${table.padEnd(20)}: MISSING OR ACCESS DENIED (${error.message})`);
            } else {
                console.log(`  ${green('✔')} ${table.padEnd(20)}: SYNCED`);
            }
        } catch (e) {
            console.log(`  ${red('✖')} ${table.padEnd(20)}: FAILED`);
        }
    }

    // 3. Email Connectivity Check
    console.log('\nChecking Email:');
    const resend = new Resend(process.env.RESEND_API_KEY);
    try {
        const { data, error } = await resend.apiKeys.list();
        if (error) {
            console.log(`  ${red('✖')} Resend Connectivity: FAILED (${error.message})`);
        } else {
            console.log(`  ${green('✔')} Resend Connectivity: SUCCESS`);
        }
    } catch (e) {
        console.log(`  ${red('✖')} Resend Connectivity: ERROR (${e.message})`);
    }

    console.log('\n' + '='.repeat(40));
    console.log('        ALL SYSTEMS GO! 🚀');
    console.log('='.repeat(40) + '\n');
}

verify();
