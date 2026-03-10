# DevOps Task Tracker - Observability & Monitoring Guide

Complete observability setup for monitoring application health, performance, and user experience. This guide uses free or low-cost tools suitable for personal and small team projects.

---

## Overview

```
┌──────────────┐
│ Application  │ Logs, Errors, Metrics
└──────┬───────┘
       │
       ├─→ Logging Service (structured logs)
       ├─→ Error Tracking (exceptions & crashes)
       ├─→ Performance Monitoring (APM)
       ├─→ Security Scanning (ESLint, Trivy, npm audit)
       └─→ Uptime Monitoring (backend health checks)
       │
       ▼
┌────────────────────────────┐
│ Dashboards & Alerts        │
│ - Real-time monitoring     │
│ - Email/Slack notifications│
└────────────────────────────┘
```

---

## 1. Logging Strategy

### Frontend Logging

The frontend logs to:
- Browser Console (development)
- Sentry (production errors)
- Network requests (browser DevTools)

### Structured Logging in Browser

Add a logging utility to `src/lib/logger.ts`:

```typescript
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export const logger = {
  debug: (message: string, data?: any) => {
    console.debug(`[${LogLevel.DEBUG}] ${message}`, data);
  },
  info: (message: string, data?: any) => {
    console.info(`[${LogLevel.INFO}] ${message}`, data);
  },
  warn: (message: string, data?: any) => {
    console.warn(`[${LogLevel.WARN}] ${message}`, data);
  },
  error: (message: string, error?: any) => {
    console.error(`[${LogLevel.ERROR}] ${message}`, error);
    // Send to Sentry in production
    if (import.meta.env.PROD) {
      // Sentry integration here
    }
  },
};
```

### Usage in Components

```typescript
import { logger } from '../lib/logger';

// In component
const handleTaskCreate = async (task: Task) => {
  try {
    logger.info('Creating task', { title: task.title });
    const { data, error } = await supabase
      .from('tasks')
      .insert([task]);

    if (error) throw error;
    logger.info('Task created successfully', { id: data[0].id });
  } catch (error) {
    logger.error('Failed to create task', error);
  }
};
```

### Supabase Logs

View logs directly in Supabase dashboard:
1. Open Supabase project dashboard
2. Navigate to **Logs** section
3. View API requests, database queries, and auth events
4. Filter by time, status, or query type

**Key logs to monitor:**
- `auth.users` table inserts (new signups)
- `tasks` table operations (CRUD)
- Failed authentication attempts
- Database connection errors

---

## 2. Error Tracking - Sentry Setup

Sentry captures frontend errors automatically and provides alerting.

### Installation

```bash
npm install @sentry/react @sentry/tracing
```

### Configuration

Create `src/lib/sentry.ts`:

```typescript
import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

export function initSentry() {
  if (!import.meta.env.PROD) return; // Only in production

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      new BrowserTracing(),
      new Sentry.Replay(),
    ],
    tracesSampleRate: 0.1, // 10% of transactions
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0, // Always capture on error
    environment: import.meta.env.MODE,
  });
}
```

### Initialize in main.tsx

```typescript
import { initSentry } from './lib/sentry';

initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
```

### Environment Variables

Add to `.env.local`:

```
VITE_SENTRY_DSN=https://your-key@sentry.io/your-project-id
```

### Usage

```typescript
// Automatic error capturing
throw new Error('Something went wrong');

// Manual event capture
Sentry.captureMessage('User action completed', 'info');

// Capture with context
Sentry.withScope((scope) => {
  scope.setContext('task', {
    id: task.id,
    status: task.status,
  });
  Sentry.captureException(error);
});
```

### Sentry Features

- **Error Grouping**: Automatically groups similar errors
- **Release Tracking**: Track errors per version
- **Source Maps**: See original TypeScript errors
- **Session Replay**: Watch user interactions before error
- **Performance Monitoring**: Track slow transactions
- **Alerts**: Email/Slack notifications on new errors

### Pricing

- **Free Tier**: 5,000 errors/month
- **Typical Usage**: Usually stays under free tier for small projects
- **Upgrade**: $29/month for 100K events

---

## 3. Performance Monitoring

### Core Web Vitals

Monitor three key metrics:

1. **Largest Contentful Paint (LCP)**: < 2.5 seconds
2. **First Input Delay (FID)**: < 100 milliseconds
3. **Cumulative Layout Shift (CLS)**: < 0.1

Add to `src/lib/metrics.ts`:

```typescript
// Measure Web Vitals
export function reportWebVitals() {
  // Largest Contentful Paint
  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const lastEntry = entries[entries.length - 1];
    console.log('LCP:', lastEntry.renderTime || lastEntry.loadTime);
  });
  observer.observe({ entryTypes: ['largest-contentful-paint'] });

  // First Input Delay
  const fidObserver = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    entries.forEach((entry) => {
      console.log('FID:', entry.processingDuration);
    });
  });
  fidObserver.observe({ entryTypes: ['first-input'] });

  // Cumulative Layout Shift
  let clsScore = 0;
  const clsObserver = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (!entry.hadRecentInput) {
        clsScore += entry.value;
        console.log('CLS:', clsScore);
      }
    });
  });
  clsObserver.observe({ entryTypes: ['layout-shift'] });
}

// Call in App.tsx useEffect
useEffect(() => {
  reportWebVitals();
}, []);
```

### Database Performance

Monitor query performance via Supabase:

```typescript
// Example: Measure task fetch time
const startTime = performance.now();

const { data, error } = await supabase
  .from('tasks')
  .select('*');

const duration = performance.now() - startTime;
console.log(`Task fetch took ${duration}ms`);

if (duration > 1000) {
  logger.warn('Slow query detected', { duration, endpoint: 'tasks' });
}
```

### API Response Times

Track in Supabase logs:

```typescript
// Supabase automatically logs query duration
// View in: Project Dashboard → Logs → API Requests
// Filter for requests taking > 100ms
```

---

## 4. Key Metrics to Track

### Application Health

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Error Rate | < 0.1% | > 1% |
| API Response Time (p95) | < 100ms | > 500ms |
| Database Query Time (p95) | < 50ms | > 200ms |
| Uptime | > 99.9% | < 99% |
| User Session Duration | N/A | Track for UX |
| Task Creation Success Rate | > 99% | < 95% |

### User Engagement

| Metric | How to Track |
|--------|--------------|
| Daily Active Users | Supabase auth logs |
| Task Creation Rate | Supabase database logs |
| Avg Tasks per User | Custom dashboard |
| Feature Usage | Sentry events |
| Error Impact (affected users) | Sentry sessions |

### Infrastructure

| Metric | Tool | Target |
|--------|------|--------|
| CPU Usage | CloudWatch / Hosting | < 70% |
| Memory Usage | CloudWatch / Hosting | < 80% |
| Network I/O | CloudWatch / Hosting | < 100Mbps |
| Database Connections | Supabase dashboard | < 80% |
| Storage Usage | Supabase dashboard | < 80% |

---

## 5. Recommended Free/Low-Cost Tools

### Error Tracking

**Sentry** (Primary)
- Automatic error capturing
- Source map support
- Session replay
- Price: Free tier (5K events/month)
- Setup: 5 minutes

```bash
npm install @sentry/react @sentry/tracing
```

### Monitoring & Uptime

**UptimeRobot** (Free)
- HTTP monitoring
- 5-minute check intervals
- Email alerts
- Price: Free tier (50 monitors)
- Dashboard: https://uptimerobot.com

Configuration:
- Monitor: https://your-domain.com/health
- Interval: 5 minutes
- Alert: Email on downtime

**Healthchecks.io** (Free)
- Cron job monitoring
- Webhook health checks
- Price: Free tier (100 checks/month)

### Logging

**Supabase Logs** (Included)
- Built into Supabase
- View API requests, auth events, errors
- Real-time log streaming
- Free: 7-day retention

Access via:
1. Supabase dashboard → Logs
2. Filter by table, status code, timestamp
3. Export logs for analysis

**Browser Console** (Free)
- Development logging
- Use structured format
- Never commit sensitive data

### Metrics & Dashboards

**Lighthouse CI** (Free)
- Automated performance testing
- CI/CD integration
- Tracks metrics over time
- Price: Free

```bash
npm install -D @lhci/cli@latest @lhci/config@latest
```

Create `lighthouserc.json`:
```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:3000"]
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

**Google PageSpeed Insights** (Free)
- Real-world performance data
- Core Web Vitals
- Monthly monitoring
- URL: https://pagespeed.web.dev

### Slack/Email Notifications

**Sentry Slack Integration**
1. In Sentry: Settings → Integrations → Slack
2. Connect workspace and channel
3. Receive error notifications

**UptimeRobot Slack**
1. In UptimeRobot: Settings → Slack
2. Connect workspace
3. Get downtime alerts

---

## 6. Dashboard Setup

### Free Monitoring Dashboard Options

#### Option 1: Supabase Dashboard (Built-in)
Best for: Database and auth monitoring

```
Supabase Console
├── Analytics
│   ├── API requests
│   ├── Database queries
│   └── Auth events
├── Logs
│   ├── Real-time logs
│   ├── Search & filter
│   └── Export capability
└── Performance
    ├── Query slowness
    ├── Auth latency
    └── Realtime stats
```

#### Option 2: Custom Dashboard (DIY)
Create a simple monitoring page:

`src/components/AdminDashboard.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalTasks: 0,
    tasksToday: 0,
    avgTasksPerUser: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      // Fetch from supabase
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, created_at')
        .gte('created_at', new Date(Date.now() - 86400000).toISOString());

      setStats({
        totalUsers: 0, // Would need to query auth
        totalTasks: 0, // Would query tasks table
        tasksToday: tasks?.length || 0,
        avgTasksPerUser: 0,
      });
    };

    fetchStats();
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white p-4 rounded">
        <h3>Tasks Created Today</h3>
        <p className="text-3xl font-bold">{stats.tasksToday}</p>
      </div>
    </div>
  );
}
```

#### Option 3: Grafana Cloud (Free tier)
Best for: Advanced metrics and alerting

- Free tier: 10K metrics
- Includes Prometheus, Loki
- Price: Free forever tier available

---

## 7. Setting Up Alerts

### Email Alerts

**Sentry Email Alerts**
1. Project Settings → Alerts → Create Alert Rule
2. Condition: `error.level is error`
3. Action: Send email
4. Frequency: Per issue or daily digest

Example rule:
```
IF error.level is error
THEN notify via email
EVERY time a new issue is added
```

**UptimeRobot Email**
1. Settings → Email Notifications → Enable
2. Receive email on downtime detected

### Slack Alerts

**Sentry to Slack**
1. Sentry → Integrations → Slack
2. Choose channel: #alerts or #errors
3. Customize alert messages

**UptimeRobot to Slack**
1. UptimeRobot → Settings → Slack
2. Post to #uptime-alerts
3. Includes downtime details

### Custom Webhooks

Send alerts to Discord, Teams, or custom service:

```typescript
// In error handler
async function alertOnCriticalError(error: Error) {
  if (import.meta.env.PROD) {
    await fetch(import.meta.env.VITE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Critical error: ${error.message}`,
        timestamp: new Date().toISOString(),
      }),
    });
  }
}
```

---

## 8. Logs Analysis & Debugging

### Common Issues to Monitor

| Issue | Detection | Resolution |
|-------|-----------|-----------|
| High error rate | Sentry dashboard | Check recent code changes |
| Slow API responses | Supabase logs | Check query performance, add indexes |
| Auth failures | Supabase auth logs | Review password reset, token issues |
| Database locks | Query slowness | Check for concurrent writes |
| Memory leaks | Browser DevTools | Check component cleanup functions |

### Analyzing Logs in Supabase

```sql
-- Find slow queries
SELECT
  timestamp,
  method,
  path,
  duration_ms
FROM request_logs
WHERE duration_ms > 100
ORDER BY duration_ms DESC
LIMIT 10;

-- Find errors
SELECT
  timestamp,
  error_code,
  error_message,
  count(*)
FROM request_logs
WHERE status_code >= 400
GROUP BY error_code, error_message
ORDER BY count DESC;
```

---

## 9. Monitoring Checklist

- [ ] Sentry project created and DSN added
- [ ] Error tracking in production
- [ ] UptimeRobot monitoring enabled
- [ ] Backend health check endpoint at `/api/health`
- [ ] Scan success rate monitoring in `scan_results`
- [ ] Job failure alerts via structured logs
- [ ] Supabase logs reviewed weekly
- [ ] Performance metrics tracked
- [ ] Database query optimization completed
- [ ] User analytics baseline established
- [ ] Alert thresholds defined
- [ ] Runbook created for common issues

---

## 10. Cost Summary

| Tool | Cost | What's Monitored |
|------|------|-----------------|
| Sentry | Free (5K events/mo) | Errors, Performance |
| UptimeRobot | Free (50 monitors) | Uptime, Availability |
| Healthchecks.io | Free (100 checks/mo) | Cron jobs |
| Supabase Logs | Included | API, DB, Auth |
| Lighthouse CI | Free | Performance |
| Google PageSpeed | Free | Core Web Vitals |
| **Total** | **$0/month** | **Full visibility** |

---

## 11. Observability Best Practices

1. **Log Levels**: Use DEBUG, INFO, WARN, ERROR appropriately
2. **Structured Logging**: Include context with every log
3. **Don't Log Secrets**: Never log passwords, tokens, keys
4. **Sample Data**: For high-volume apps, sample logs
5. **Correlation IDs**: Track requests across services
6. **Alert Fatigue**: Avoid too many alerts
7. **Runbooks**: Document how to respond to alerts
8. **Regular Reviews**: Weekly check of errors and metrics
9. **Performance Budgets**: Set targets for Core Web Vitals
10. **User Impact**: Focus on metrics that affect users

---

## 12. Example Runbook

### Alert: High Error Rate

**Condition**: Error rate > 1%

**Steps**:
1. Check Sentry dashboard for error pattern
2. Review recent code deployments
3. Check Supabase logs for database issues
4. Verify API rate limits not exceeded
5. Check infrastructure metrics (CPU, memory)
6. Roll back recent changes if needed
7. Post-incident review

**Prevention**:
- Better error handling
- More comprehensive testing
- Gradual rollouts with feature flags
- Better monitoring coverage

---

This observability setup provides complete visibility with zero cost for small to medium projects while scaling with your application needs.
