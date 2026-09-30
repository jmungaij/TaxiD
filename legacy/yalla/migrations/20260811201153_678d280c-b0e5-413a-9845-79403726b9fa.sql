REVOKE ALL ON FUNCTION public.ops_work_request_approval(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_work_decide_approval(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_apply_writeback(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_notification_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_work_request_approval(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_decide_approval(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_apply_writeback(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_notification_mark_read(uuid) TO authenticated;