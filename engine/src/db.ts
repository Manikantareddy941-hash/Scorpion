import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

export const updateScanStatus = async (
    scanId: string,
    newStatus: string,
    previousStatus?: string,
    extra?: Record<string, any>,
    client?: any
) => {
    let sql = 'UPDATE scans SET status = $1, updated_at = NOW()';
    const params: any[] = [newStatus, scanId];
    const exec = client || pool;

    if (previousStatus) {
        sql += ' WHERE id = $2 AND status = $3';
        params.push(previousStatus);
    } else {
        sql += ' WHERE id = $2';
    }

    if (extra) {
        Object.entries(extra).forEach(([key, value]) => {
            sql = sql.replace('SET', `SET ${key} = $${params.length + 1},`);
            params.push(value);
        });
    }

    // Clean up potential trailing comma if extra fields were added
    sql = sql.replace(', WHERE', ' WHERE');

    const result = await exec.query(sql, params);
    return (result.rowCount ?? 0) > 0;
};

export default pool;
