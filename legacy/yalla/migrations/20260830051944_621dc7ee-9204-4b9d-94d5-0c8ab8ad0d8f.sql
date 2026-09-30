CREATE OR REPLACE FUNCTION public._lg_dossier_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc         public.lg_dossier_documents;
  v_gate_state  text;
  v_events      text[] := ARRAY[NEW.action];
  v_event       text;
  v_subject     text;
  v_body        text;
  r             record;
BEGIN
  SELECT * INTO v_doc FROM public.lg_dossier_documents WHERE id = NEW.document_version_id;

  IF NEW.action = 'APPROVAL_RECORDED' THEN
    SELECT gate_state INTO v_gate_state
      FROM public.v_lg_dossier_gate WHERE control_id = NEW.control_id;
    IF v_gate_state = 'EFFECTIVE' THEN
      v_events := v_events || 'BECAME_EFFECTIVE';
    END IF;
  END IF;

  FOREACH v_event IN ARRAY v_events LOOP
    v_subject := CASE v_event
      WHEN 'SEEDED'            THEN format('LG dossier filed for review — %s', NEW.control_id)
      WHEN 'VERSION_PUBLISHED' THEN format('LG dossier version %s published — %s', COALESCE(NEW.document_version, 0), NEW.control_id)
      WHEN 'SUPERSEDED'        THEN format('LG dossier version superseded — %s', NEW.control_id)
      WHEN 'APPROVAL_RECORDED' THEN format('LG determination decision recorded — %s', NEW.control_id)
      ELSE format('LG determination is now effective — %s', NEW.control_id)
    END;

    v_body := format(
      '%s (%s) version %s. %s%sBooking and dispatch remain closed for this control until an authorised legal, insurer (where required) and owner approval exist against this exact version with a real effective date.',
      COALESCE(v_doc.title, NEW.control_id),
      COALESCE(v_doc.document_id, NEW.control_id),
      COALESCE(NEW.document_version, 0),
      COALESCE(NEW.detail || ' ', ''),
      CASE WHEN v_event = 'BECAME_EFFECTIVE'
           THEN 'All required approvals are now recorded and the determination is operationally effective. '
           ELSE '' END);

    -- One notice per stakeholder, listing every authority that person holds.
    FOR r IN
      SELECT ur.user_id,
             string_agg(DISTINCT m.approver_kind || ':' || m.role, ', ' ORDER BY m.approver_kind || ':' || m.role) AS authority,
             max(u.email) AS email
        FROM public.lg_approver_role_map m
        JOIN public.user_roles ur ON ur.role::text = m.role
        JOIN auth.users u ON u.id = ur.user_id
       WHERE m.allowed AND m.notify
         AND (m.control_id IS NULL OR m.control_id = NEW.control_id)
       GROUP BY ur.user_id
    LOOP
      INSERT INTO public.staff_notifications (
        recipient_user_id, actor_user_id, kind, title, body, source_of_record, source_record_id)
      VALUES (
        r.user_id, NEW.actor_user_id,
        CASE WHEN v_event IN ('APPROVAL_RECORDED','BECAME_EFFECTIVE') THEN 'decision_recorded' ELSE 'decision_requested' END,
        v_subject, v_body, 'lg_dossier_audit', NEW.id);

      INSERT INTO public.lg_dossier_notifications (
        audit_id, control_id, document_id, document_version_id, document_version, event, channel,
        recipient_role, recipient_user_id, recipient_email, subject, body, payload, idempotency_key)
      VALUES (
        NEW.id, NEW.control_id, v_doc.document_id, NEW.document_version_id, NEW.document_version,
        v_event, 'in_app', r.authority, r.user_id, r.email, v_subject, v_body,
        jsonb_build_object('folder_path', v_doc.folder_path, 'file_name', v_doc.file_name,
                           'gate_state', v_gate_state, 'content_hash', NEW.content_hash),
        format('%s:%s:in_app:%s', v_event, NEW.id, r.user_id))
      ON CONFLICT (idempotency_key) DO NOTHING;

      IF r.email IS NOT NULL THEN
        INSERT INTO public.lg_dossier_notifications (
          audit_id, control_id, document_id, document_version_id, document_version, event, channel,
          recipient_role, recipient_user_id, recipient_email, subject, body, payload, idempotency_key)
        VALUES (
          NEW.id, NEW.control_id, v_doc.document_id, NEW.document_version_id, NEW.document_version,
          v_event, 'email', r.authority, r.user_id, r.email, v_subject, v_body,
          jsonb_build_object('folder_path', v_doc.folder_path, 'file_name', v_doc.file_name,
                             'gate_state', v_gate_state, 'content_hash', NEW.content_hash,
                             'approver_kind', NEW.approver_kind, 'decision', NEW.decision),
          format('%s:%s:email:%s', v_event, NEW.id, r.user_id))
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION public._lg_dossier_notify() FROM PUBLIC, anon, authenticated;
