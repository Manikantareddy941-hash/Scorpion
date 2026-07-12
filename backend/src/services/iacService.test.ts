import { summarizePlan } from './iacService';

describe('summarizePlan', () => {
    it('counts create, update, delete, replace and skips no-ops', () => {
        const planJson = {
            resource_changes: [
                { address: 'aws_instance.web', change: { actions: ['create'] } },
                { address: 'aws_s3_bucket.logs', change: { actions: ['create'] } },
                { address: 'aws_security_group.web', change: { actions: ['update'] } },
                { address: 'aws_instance.old', change: { actions: ['delete'] } },
                { address: 'aws_instance.rotated', change: { actions: ['delete', 'create'] } },
                { address: 'aws_iam_role.unchanged', change: { actions: ['no-op'] } },
            ],
        };

        const summary = summarizePlan(planJson);

        expect(summary.create).toBe(2);
        expect(summary.update).toBe(1);
        expect(summary.delete).toBe(1);
        expect(summary.replace).toBe(1);
        expect(summary.changes).toHaveLength(5); // no-op excluded
        expect(summary.changes[0]).toEqual({ address: 'aws_instance.web', actions: ['create'] });
    });

    it('returns zeros for an empty plan', () => {
        expect(summarizePlan({})).toEqual({ create: 0, update: 0, delete: 0, replace: 0, changes: [] });
    });
});
