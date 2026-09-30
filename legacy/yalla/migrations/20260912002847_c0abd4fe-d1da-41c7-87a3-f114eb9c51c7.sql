DO $$
DECLARE _lead uuid := '5f8968a8-a96b-4268-bff0-05834bcb6d3d';
        _acct uuid := 'f24280ba-4350-4f44-9f0d-49c14edd1e0b';
        _staff uuid := 'ddad62ad-6b5a-4a14-bc41-688910d44d40';
        _sent timestamptz := '2026-09-11 17:57:00+00';
        _msg uuid; _fu uuid;
BEGIN
  UPDATE public.sales_leads
     SET contact_email = 'winfred@ariyaenergy.com',
         stage = CASE WHEN stage = 'NEW' THEN 'QUOTED' ELSE stage END,
         proposal_sent_at = COALESCE(proposal_sent_at, _sent),
         notes = COALESCE(notes || E'\n', '') ||
           'Mobility Service Contract (Aug 2026 revision) emailed to Winfred for review and signature on 11 Sep 2026 by Florence Muthoni. Contact email corrected from ariyafinergy.com to ariyaenergy.com per the address actually used.'
   WHERE id = _lead;

  INSERT INTO public.sales_lead_messages(
    lead_id, direction, channel, subject, body, recipient_email, sender_name,
    actor_staff_member_id, intent, created_at)
  VALUES (_lead, 'OUTBOUND', 'EMAIL',
    'Contract for review & signature',
    'Hello Winfred,'||E'\n\n'||'I trust that this email finds you well.'||E'\n\n'||
    'Please find attached the contract and terms of service.'||E'\n\n'||
    'Kindly take a moment to review the terms, including the scope, timeline, and payment details.'||E'\n\n'||
    'If everything is in order, please sign and return a copy at your earliest convenience. Should you have any questions or need any clarification, feel free to reach out.'||E'\n\n'||
    'We look forward to working with you.'||E'\n\n'||'Best regards,'||E'\n'||'Florence Muthoni'||E'\n\n'||
    '[Recorded from the sent email. Attachment: Mobility Service Contract updated on Aug 2026.pdf, ~13 MB, held in the sender mailbox.]',
    'winfred@ariyaenergy.com', 'Florence Muthoni', _staff, 'PROPOSAL_CHASE', _sent)
  RETURNING id INTO _msg;

  INSERT INTO public.crm_interactions(
    account_id, staff_id, interaction_type, direction, subject, summary, outcome, occurred_at, provenance)
  VALUES (_acct, _staff, 'proposal', 'outbound',
    'Contract for review & signature sent to Winfred',
    'Mobility Service Contract (Aug 2026 revision) sent by email to winfred@ariyaenergy.com for review and signature. Attachment retained in the sender mailbox.',
    'Awaiting signed copy from the customer.', _sent, 'recorded_from_sent_email');

  INSERT INTO public.sales_lead_followups(
    lead_id, sales_staff_id, logged_note, contact_date, next_action, due_date, status)
  VALUES (_lead, _staff,
    'Contract and terms of service emailed to Winfred at Ariya Energy Limited for review and signature.',
    '2026-09-11',
    'Confirm receipt and chase the signed contract copy from Winfred.',
    '2026-09-16', 'OPEN')
  RETURNING id INTO _fu;

  INSERT INTO public.sales_lead_events(lead_id, action, note, detail)
  VALUES (_lead, 'OUTREACH_SENT', 'Contract for review & signature',
          jsonb_build_object('message_id', _msg, 'followup_id', _fu, 'channel', 'EMAIL'));
END $$;