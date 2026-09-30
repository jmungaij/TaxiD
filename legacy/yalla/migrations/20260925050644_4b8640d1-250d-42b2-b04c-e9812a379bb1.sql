DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.my_client_portal'::regproc);
  d := replace(d, $r$jsonb_build_object('topic', m.topic, 'starts_at', m.starts_at, 'status', m.status, 'join_url', m.join_url)$r$,
    $r$jsonb_build_object('id', m.id, 'topic', m.topic, 'starts_at', m.starts_at, 'status', m.status, 'join_url', m.join_url, 'type', (SELECT name FROM meeting_types t WHERE t.id = m.meeting_type_id), 'host', (SELECT public_name FROM meeting_type_hosts h WHERE h.staff_id = m.host_staff_id LIMIT 1))$r$);
  EXECUTE d;
END $$;