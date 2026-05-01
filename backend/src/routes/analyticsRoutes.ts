import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// GET /api/analytics/trends
router.get('/trends', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);

        // Fetch vulnerabilities within the date range
        // Note: For scalability, we limit to 5000. In a real system, you might aggregate this in a background job
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.greaterThanEqual('detected_at', dateLimit.toISOString()),
            Query.limit(5000)
        ]);

        // Group by Date (YYYY-MM-DD) and Severity
        const trendsData: Record<string, { Critical: number, High: number, Medium: number, Low: number }> = {};

        // Pre-fill dates for the last N days to ensure continuous chart
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            trendsData[dateStr] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
        }

        response.documents.forEach(vuln => {
            const rawDate = vuln.detected_at || vuln.$createdAt;
            const dateStr = rawDate.split('T')[0];
            const severity = vuln.severity?.toLowerCase();
            
            if (!trendsData[dateStr]) {
                trendsData[dateStr] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
            }

            if (severity === 'critical') trendsData[dateStr].Critical++;
            else if (severity === 'high') trendsData[dateStr].High++;
            else if (severity === 'medium') trendsData[dateStr].Medium++;
            else if (severity === 'low') trendsData[dateStr].Low++;
        });

        // Convert to array format for Recharts
        const chartData = Object.keys(trendsData).sort().map(date => ({
            date,
            Critical: trendsData[date].Critical,
            High: trendsData[date].High,
            Medium: trendsData[date].Medium,
            Low: trendsData[date].Low
        }));

        res.json(chartData);
    } catch (error) {
        next(error);
    }
});

export default router;
