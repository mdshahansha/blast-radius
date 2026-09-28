SELECT o.id, o.total, u.full_name AS customer
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.created_at > now() - interval '7 days';
