SELECT id, status, updated_at FROM scans WHERE id IN ('ef834be2-afb4-40fe-804a-8e5e89e31459', 'b877dfa7-473e-46b8-8caf-79c55a96ea05', '055b75d6-418f-48f7-950f-70d610b55ad2', 'd77bb111-74cc-4e27-a3c6-9fe86956b87c');
SELECT status, count(*) FROM scans GROUP BY status;
